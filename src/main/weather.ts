// Weather provider for the chatbox.
//
// Inspired by VRCOSC's Weather module — fetches current conditions from a free
// public source. We use Open-Meteo (https://open-meteo.com) which requires no
// API key and supports city/zip/postcode geocoding via its companion geocoder.
//
// Cadence: a hot snapshot is cached for 30 minutes — VRChat's chatbox does not
// need second-by-second weather, and the free tier is rate-limited. A second
// 30-min cache for the geocoder result keeps lookups for the user's city to
// one outbound call per ~5 hours of session.
//
// Returns a tiny shape so the formatter can interpolate {tempC}, {tempF},
// {desc}, {city}, {code} into the template freely.

import log from 'electron-log';

export interface WeatherSnapshot {
  available: boolean;
  city: string;
  tempC: number;
  tempF: number;
  /** WMO weather code 0..99. See https://open-meteo.com/en/docs#weathervariables */
  code: number;
  /** Short, human-readable conditions: "Clear", "Light rain", "Snow" etc. */
  desc: string;
  /** Wind speed in km/h. */
  windKph: number;
  /** Epoch ms when this snapshot was fetched. */
  fetchedAt: number;
}

interface GeoHit {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
}

/** Map a WMO code to a short label. Source: open-meteo docs. */
function describeWmo(code: number): string {
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mostly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 55) return 'Drizzle';
  if (code === 56 || code === 57) return 'Freezing drizzle';
  if (code >= 61 && code <= 65) return 'Rain';
  if (code === 66 || code === 67) return 'Freezing rain';
  if (code >= 71 && code <= 75) return 'Snow';
  if (code === 77) return 'Snow grains';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code === 95) return 'Thunderstorm';
  if (code === 96 || code === 99) return 'Thunder + hail';
  return 'Unknown';
}

export class WeatherProvider {
  private cached: WeatherSnapshot | null = null;
  private geoCache: { query: string; hit: GeoHit; at: number } | null = null;
  /** IP-derived location cache. Location barely moves, so cache it for a few
   *  hours to avoid hitting the geo-IP service on every weather refresh. */
  private ipCache: { hit: GeoHit; at: number } | null = null;
  private static readonly TTL_MS = 30 * 60_000;
  private static readonly GEO_TTL_MS = 5 * 60 * 60_000;
  private static readonly IP_TTL_MS = 3 * 60 * 60_000;

  /** Get a snapshot — possibly cached.
   *  @param query City / postcode / zip. Ignored when `auto` is true.
   *  @param auto  Resolve the location from the user's IP address instead. */
  async get(query: string, auto = false): Promise<WeatherSnapshot> {
    try {
      // Resolve the target location: IP-based when auto, otherwise geocode
      // the user's typed query.
      let geo: GeoHit | null;
      if (auto) {
        geo = await this.resolveIpLocation();
        if (!geo) return this.unavailable('auto');
      } else {
        const q = (query || '').trim();
        if (!q) return this.unavailable('');
        geo = await this.geocode(q);
        if (!geo) return this.unavailable(q);
      }
      // 30-minute cache on the current-weather snapshot, keyed by resolved city.
      const now = Date.now();
      if (
        this.cached &&
        this.cached.city.toLowerCase() === geo.name.toLowerCase() &&
        now - this.cached.fetchedAt < WeatherProvider.TTL_MS
      ) {
        return this.cached;
      }
      const snap = await this.fetchCurrent(geo);
      this.cached = snap;
      return snap;
    } catch (e) {
      log.warn('[weather] fetch failed:', (e as Error).message);
      return this.unavailable(auto ? 'auto' : query);
    }
  }

  /** Resolve the user's approximate location from their public IP via
   *  ipapi.co (free, HTTPS, no API key). City-level accuracy — plenty for a
   *  chatbox weather line. Cached for a few hours. */
  private async resolveIpLocation(): Promise<GeoHit | null> {
    const now = Date.now();
    if (this.ipCache && now - this.ipCache.at < WeatherProvider.IP_TTL_MS) {
      return this.ipCache.hit;
    }
    const res = await fetch('https://ipapi.co/json/', {
      headers: { 'User-Agent': 'UvsChatBox/1.0' },
    });
    if (!res.ok) throw new Error(`ip-geo http ${res.status}`);
    const j = (await res.json()) as {
      city?: string;
      region?: string;
      latitude?: number;
      longitude?: number;
      error?: boolean;
    };
    if (j.error || typeof j.latitude !== 'number' || typeof j.longitude !== 'number') {
      return null;
    }
    const hit: GeoHit = {
      name: j.city || j.region || 'My location',
      latitude: j.latitude,
      longitude: j.longitude,
    };
    this.ipCache = { hit, at: now };
    return hit;
  }

  private unavailable(city: string): WeatherSnapshot {
    return {
      available: false,
      city,
      tempC: 0,
      tempF: 0,
      code: -1,
      desc: 'Unavailable',
      windKph: 0,
      fetchedAt: Date.now(),
    };
  }

  private async geocode(query: string): Promise<GeoHit | null> {
    const now = Date.now();
    if (
      this.geoCache &&
      this.geoCache.query.toLowerCase() === query.toLowerCase() &&
      now - this.geoCache.at < WeatherProvider.GEO_TTL_MS
    ) {
      return this.geoCache.hit;
    }
    const url = `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'UvsChatBox/1.0' } });
    if (!res.ok) throw new Error(`geocode http ${res.status}`);
    const j: unknown = await res.json();
    const results = (j as { results?: unknown[] }).results;
    if (!Array.isArray(results) || results.length === 0) return null;
    const r0 = results[0] as Partial<GeoHit>;
    if (!r0 || typeof r0.latitude !== 'number' || typeof r0.longitude !== 'number') return null;
    const hit: GeoHit = {
      name: r0.name || query,
      latitude: r0.latitude,
      longitude: r0.longitude,
      country: r0.country,
    };
    this.geoCache = { query, hit, at: now };
    return hit;
  }

  private async fetchCurrent(geo: GeoHit): Promise<WeatherSnapshot> {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current=temperature_2m,weather_code,wind_speed_10m`;
    const res = await fetch(url, { headers: { 'User-Agent': 'UvsChatBox/1.0' } });
    if (!res.ok) throw new Error(`weather http ${res.status}`);
    const j = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number };
    };
    const cur = j.current ?? {};
    const tempC = Math.round((cur.temperature_2m ?? 0) * 10) / 10;
    const tempF = Math.round(((tempC * 9) / 5 + 32) * 10) / 10;
    const code = cur.weather_code ?? -1;
    return {
      available: true,
      city: geo.name,
      tempC,
      tempF,
      code,
      desc: describeWmo(code),
      windKph: Math.round((cur.wind_speed_10m ?? 0) * 10) / 10,
      fetchedAt: Date.now(),
    };
  }
}
