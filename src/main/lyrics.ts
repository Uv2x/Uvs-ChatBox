// LyricsService: fetches synced lyrics from LRCLib (lrclib.net) and picks the
// line that matches the song's current playback position.
//
// Why LRCLib:
//   - Free, public, no API key required.
//   - Returns LRC-format lyrics with [mm:ss.xx] timestamps per line.
//   - Better coverage than expected for mainstream music.
//
// Caching strategy:
//   - In-memory only (no need to persist to disk; restart is cheap).
//   - Positive cache: keep parsed lyrics for ~24h.
//   - Negative cache: remember misses for ~1h so we don't hammer the API on
//     obscure tracks that simply have no synced lyrics.
//   - In-flight dedupe: if a fetch is already running for a given key, the
//     second caller awaits the same promise.

import log from 'electron-log';

export interface LyricLine {
  /** Playback position in seconds at which this line starts. */
  atSec: number;
  text: string;
}

export interface LyricsTrack {
  artist: string;
  title: string;
  synced: LyricLine[];
  /** Unsynced plain text, if LRCLib only had that. */
  plain: string | null;
}

const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const NEGATIVE_TTL_MS = 60 * 60 * 1000; //  1h
/** Outage backoff: 15s, 30s, 60s, then capped at 2 min while LRCLib is down. */
const BACKOFF_BASE_MS = 15_000;
const BACKOFF_MAX_MS = 120_000;

interface CacheEntry {
  expires: number;
  track: LyricsTrack | null; // null = negative (no lyrics available)
}

/** Result of one LRCLib request. `unavailable` = the SERVICE failed (5xx,
 *  429, network) — transient, and must never be cached as "this song has no
 *  lyrics". A plain miss (404 / empty results) is a real answer. */
interface Lookup {
  track: LyricsTrack | null;
  unavailable: boolean;
}
const MISS: Lookup = { track: null, unavailable: false };
const DOWN: Lookup = { track: null, unavailable: true };

export interface LyricsStatus {
  /** False while LRCLib is failing (outage / overload / no network). */
  available: boolean;
  /** Last failure reason, e.g. "HTTP 502". Empty when healthy. */
  error: string;
  /** Seconds until the next retry while backing off. */
  retryInSec: number;
}

export class LyricsService {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<LyricsTrack | null>>();
  private failStreak = 0;
  private downUntil = 0;
  private lastError = '';

  /** Health of the lyrics source, for the UI. */
  status(): LyricsStatus {
    return {
      available: this.failStreak === 0,
      error: this.lastError,
      retryInSec: Math.max(0, Math.ceil((this.downUntil - Date.now()) / 1000)),
    };
  }

  /** Active probe for the System Check page: one request for a well-known
   *  song. Any real answer (200 / 404) means LRCLib is up; 5xx / 429 /
   *  network failure means it's down. Feeds the same health + backoff state
   *  the live lookups use. */
  async probe(): Promise<LyricsStatus> {
    try {
      const res = await fetch('https://lrclib.net/api/get?artist_name=Adele&track_name=Hello', {
        headers: { 'User-Agent': 'uvs-chatbox/1.1 (+https://github.com/Uv2x/Uvs-ChatBox)' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.status >= 500 || res.status === 429) this.noteDown(`HTTP ${res.status}`);
      else this.noteUp();
    } catch (e) {
      this.noteDown((e as Error).message || 'network error');
    }
    return this.status();
  }

  /** LRCLib itself failed — back off (doubling, capped) instead of hammering
   *  a struggling service. Logs once per backoff window. */
  private noteDown(reason: string): void {
    this.failStreak++;
    const backoff = Math.min(BACKOFF_BASE_MS * 2 ** (this.failStreak - 1), BACKOFF_MAX_MS);
    this.downUntil = Date.now() + backoff;
    this.lastError = reason;
    log.warn(
      `[lyrics] LRCLib API unavailable (${reason}) — not caching misses; retrying in ${Math.round(backoff / 1000)}s`,
    );
  }

  /** Any real answer from LRCLib (even a 404) means the service is healthy. */
  private noteUp(): void {
    if (this.failStreak > 0) log.info('[lyrics] LRCLib API is responding again');
    this.failStreak = 0;
    this.downUntil = 0;
    this.lastError = '';
  }

  /** Handle a non-OK response. 5xx / 429 = service trouble (transient);
   *  anything else (404, 400…) is a real "not found" answer. */
  private nonOk(status: number, what: string): Lookup {
    if (status >= 500 || status === 429) {
      this.noteDown(`HTTP ${status}`);
      return DOWN;
    }
    this.noteUp();
    if (status !== 404) log.info(`[lyrics] ${what} returned HTTP ${status}`);
    return MISS;
  }

  private key(artist: string, title: string): string {
    return `${artist.trim().toLowerCase()}::${title.trim().toLowerCase()}`;
  }

  /** Parse an LRC body into sorted lines with absolute seconds. */
  private parseLrc(lrc: string): LyricLine[] {
    const out: LyricLine[] = [];
    // [mm:ss.xx]text  or [mm:ss]text. Some lines have multiple [..] prefixes.
    const tagRe = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    for (const raw of lrc.split(/\r?\n/)) {
      const text = raw.replace(tagRe, '').trim();
      if (!text) continue;
      tagRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = tagRe.exec(raw)) !== null) {
        const mm = Number(m[1]);
        const ss = Number(m[2]);
        const fracStr = m[3] ?? '0';
        const frac = Number(fracStr.padEnd(3, '0').slice(0, 3)) / 1000;
        out.push({ atSec: mm * 60 + ss + frac, text });
      }
    }
    out.sort((a, b) => a.atSec - b.atSec);
    return out;
  }

  /** Strip metadata noise that prevents track matching against LRCLib.
   *  Covers four classes of clutter:
   *    1. Edition tags:    "(Remastered)", "(Single Version)", "- Radio Edit"
   *    2. Featured artists: "(feat. X)", "(with Y)"
   *    3. Soundtrack refs: "- From the '8 Mile' Soundtrack"
   *    4. Edit / remix tags from YouTube/SoundCloud channels:
   *       "- slowed", "- sped up", "- nightcore", "(lofi)", "(8d)", etc.
   *       These come from uploads where the "artist" is the editor's
   *       channel and the title carries the edit name. LRCLib indexes the
   *       original tracks, not the edits. */
  private cleanTitle(s: string): string {
    return (
      s
        // Generic " - tag.." trailing forms
        .replace(
          /\s*[-–—]\s*(Remastered|Remaster|From .*?Soundtrack.*|Single Version|Radio Edit|Live|Acoustic|Bonus Track|Deluxe|Slowed( and Reverb| \+ Reverb)?|Sped[\s-]?Up|Nightcore|Lofi|Lo-?Fi|8D|Bass Boosted|Reverb|Tiktok|TikTok Version|Extended).*$/i,
          '',
        )
        // Parenthetical or bracketed annotations
        .replace(
          /\s*\((Feat\.|feat\.|ft\.|with|Remastered|Remaster|Live|Acoustic|Slowed( and Reverb| \+ Reverb)?|Sped[\s-]?Up|Nightcore|Lofi|Lo-?Fi|8D|Bass Boosted|Reverb).*?\)/gi,
          '',
        )
        .replace(
          /\s*\[(Feat\.|feat\.|ft\.|with|Remastered|Remaster|Live|Acoustic|Slowed( and Reverb| \+ Reverb)?|Sped[\s-]?Up|Nightcore|Lofi|Lo-?Fi|8D|Bass Boosted|Reverb).*?\]/gi,
          '',
        )
        .trim()
    );
  }
  private cleanArtist(s: string): string {
    return s
      .replace(/\s*(feat\.|featuring|ft\.)\s+.*$/i, '')
      .split(/[,&;]| x /i)[0]!
      .trim();
  }

  /** Normalize a title for equality comparison: lowercase, strip everything
   *  that isn't a word character or whitespace, collapse runs of space. */
  private normalizeTitle(s: string): string {
    return s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async tryGet(artist: string, title: string): Promise<Lookup> {
    const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'uvs-chatbox/1.1 (+https://github.com/Uv2x/Uvs-ChatBox)' },
      });
      if (!res.ok) return this.nonOk(res.status, '/api/get');
      this.noteUp();
      const data = (await res.json()) as {
        syncedLyrics?: string | null;
        plainLyrics?: string | null;
      };
      const synced = data.syncedLyrics ? this.parseLrc(data.syncedLyrics) : [];
      const plain = (data.plainLyrics ?? null) || null;
      if (synced.length === 0 && !plain) return MISS;
      return { track: { artist, title, synced, plain }, unavailable: false };
    } catch (e) {
      // Network failure / DNS / TLS — the service is unreachable, not "no lyrics".
      this.noteDown((e as Error).message || 'network error');
      return DOWN;
    }
  }

  /** Fuzzy search by artist + title. Hardened with the same rules as the
   *  title-only fallback:
   *   - LRCLib returns CONTAINS-style results (a search for "THE ROOM"
   *     returns "Love Has Left The Room"), so we filter results down to
   *     entries whose normalized title equals our query.
   *   - Artist must substring-match (case-insensitive) — i.e. the LRCLib
   *     `artistName` contains our cleaned artist OR vice versa. This rejects
   *     "A Camp" for a search of "Ayla Reed".
   *   - If we know the local track duration, the LRCLib `duration` must be
   *     within ±15 s. Multiple songs may share a (title, artist) combo
   *     across releases / live versions / acoustic / etc.; duration picks
   *     the right one. */
  private async trySearch(
    artist: string,
    title: string,
    expectedDurationSec: number | null,
  ): Promise<Lookup> {
    const url = `https://lrclib.net/api/search?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'uvs-chatbox/1.1 (+https://github.com/Uv2x/Uvs-ChatBox)' },
      });
      if (!res.ok) return this.nonOk(res.status, '/api/search');
      this.noteUp();
      const raw = (await res.json()) as Array<{
        artistName: string;
        trackName: string;
        duration?: number | null;
        syncedLyrics?: string | null;
        plainLyrics?: string | null;
      }>;
      if (!Array.isArray(raw) || raw.length === 0) return MISS;

      const wantTitle = this.normalizeTitle(title);
      const wantArtist = artist.toLowerCase().trim();

      // Filter 1: exact (normalized) title.
      const titleExact = raw.filter((r) => this.normalizeTitle(r.trackName) === wantTitle);
      if (titleExact.length === 0) {
        log.info(
          `[lyrics] search: no exact title match for "${title}" (raw returned ${raw.length})`,
        );
        return MISS;
      }

      // Filter 2: artist match. Allows substring either direction so
      // "Eminem" matches "Eminem & Dido" / "Eminem, Dido", but rejects
      // unrelated artists. Extra guard: very short substrings (≤3 chars)
      // are too noisy — e.g. searching "U2" would match every artist
      // whose name contains "u2", which is common. Require the local
      // artist name to be at least 4 chars before allowing substring; for
      // shorter names require an exact (normalized) artist match.
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
      const wantArtistNorm = norm(wantArtist);
      const artistOk = titleExact.filter((r) => {
        const a = norm(r.artistName);
        if (wantArtistNorm.length <= 3) return a === wantArtistNorm;
        return a.includes(wantArtistNorm) || wantArtistNorm.includes(a);
      });
      if (artistOk.length === 0) {
        log.info(`[lyrics] search: title matched but no artist contains "${artist}" — refusing`);
        return MISS;
      }

      // Filter 3 (when applicable): duration window.
      let pool = artistOk;
      if (expectedDurationSec && expectedDurationSec > 0) {
        const withDur = artistOk.filter((r) => typeof r.duration === 'number' && r.duration > 0);
        if (withDur.length > 0) {
          withDur.sort(
            (a, b) =>
              Math.abs((a.duration ?? 0) - expectedDurationSec) -
              Math.abs((b.duration ?? 0) - expectedDurationSec),
          );
          const best = withDur[0]!;
          const diff = Math.abs((best.duration ?? 0) - expectedDurationSec);
          if (diff > 15) {
            log.info(`[lyrics] search: closest duration off by ${diff.toFixed(1)}s — refusing`);
            return MISS;
          }
          pool = [best];
        }
      }

      // Among survivors prefer more synced lines.
      const ranked = pool
        .map((r) => ({ r, synced: r.syncedLyrics ? this.parseLrc(r.syncedLyrics) : [] }))
        .sort((a, b) => b.synced.length - a.synced.length);
      const best = ranked[0];
      if (!best) return MISS;
      if (best.synced.length === 0 && !best.r.plainLyrics) return MISS;

      log.info(
        `[lyrics] search matched "${best.r.artistName} — ${best.r.trackName}" (${best.synced.length} synced, dur=${best.r.duration ?? '?'}s)`,
      );
      return {
        track: {
          artist: best.r.artistName,
          title: best.r.trackName,
          synced: best.synced,
          plain: (best.r.plainLyrics ?? null) || null,
        },
        unavailable: false,
      };
    } catch (e) {
      // Network failure — the service is unreachable, not "no lyrics".
      this.noteDown((e as Error).message || 'network error');
      return DOWN;
    }
  }

  /** Look up lyrics for (artist, title). Returns null if LRCLib has nothing.
   *  `durationSec` is optional; when provided it's used by the title-only
   *  fallback to pick the right song among multiple sharing a title. */
  async fetch(
    artist: string,
    title: string,
    durationSec?: number | null,
  ): Promise<LyricsTrack | null> {
    const k = this.key(artist, title);
    const now = Date.now();

    // Cache hit (positive or negative)?
    const hit = this.cache.get(k);
    if (hit && hit.expires > now) return hit.track;

    // LRCLib is down — sit out the backoff window. Deliberately NOT cached,
    // so this song is retried as soon as the service is back.
    if (now < this.downUntil) return null;

    // In-flight dedupe.
    const existing = this.inflight.get(k);
    if (existing) return existing;

    const p = (async (): Promise<LyricsTrack | null> => {
      try {
        const artistClean = this.cleanArtist(artist);
        const titleClean = this.cleanTitle(title);

        // 1) Exact get with raw values.
        let r = await this.tryGet(artist, title);
        if (r.unavailable) return null; // outage: don't cache, don't keep hammering
        let track = r.track;
        // 2) Exact get with cleaned values (handles "feat.", "Remastered", etc).
        if (!track && (artistClean !== artist || titleClean !== title)) {
          log.info(`[lyrics] retry get with cleaned: "${artistClean} — ${titleClean}"`);
          r = await this.tryGet(artistClean, titleClean);
          if (r.unavailable) return null;
          track = r.track;
        }
        // 3) Fuzzy search by artist+title (strictly filtered: exact title,
        //    artist substring, duration window — see trySearch).
        if (!track) {
          log.info(`[lyrics] /api/get miss for "${artist} — ${title}", trying search…`);
          r = await this.trySearch(artistClean || artist, titleClean || title, durationSec ?? null);
          if (r.unavailable) return null;
          track = r.track;
        }
        // Title-only fallback INTENTIONALLY REMOVED. Previously a step 4
        // searched LRCLib by title alone (with duration window) — but that
        // allows covers / same-name-different-artist songs ("Berlin",
        // "Stay", "Heaven", "Love Story" by N different artists) to match,
        // and the resulting lyric line is just wrong. Better to show no
        // lyrics than someone else's song. If you want fuzzier matching
        // back, restore trySearchTitleOnly here behind an opt-in setting.

        if (!track) {
          log.info(
            `[lyrics] no exact artist+title match for "${artist} — ${title}" — staying silent (no title-only fallback)`,
          );
          this.cache.set(k, { expires: now + NEGATIVE_TTL_MS, track: null });
          return null;
        }
        this.cache.set(k, { expires: now + POSITIVE_TTL_MS, track });
        log.info(
          `[lyrics] cached "${track.artist} — ${track.title}" (${track.synced.length} synced lines)`,
        );
        return track;
      } catch (e) {
        log.warn(`[lyrics] fetch failed for "${artist} — ${title}":`, e);
        this.cache.set(k, { expires: now + 60_000, track: null });
        return null;
      } finally {
        this.inflight.delete(k);
      }
    })();

    this.inflight.set(k, p);
    return p;
  }

  /** Pick the synced line for a given playback position. Returns null if no
   *  synced lyrics are loaded or position is before the first line. */
  getCurrentLine(track: LyricsTrack | null, positionSec: number): string | null {
    if (!track || track.synced.length === 0) return null;
    // Binary search would be overkill — synced lyric counts are small.
    let active: LyricLine | null = null;
    for (const line of track.synced) {
      if (line.atSec <= positionSec) active = line;
      else break;
    }
    return active?.text ?? null;
  }
}
