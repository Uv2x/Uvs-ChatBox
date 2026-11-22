import type { MediaInfo } from '../shared/types';
import { PsJsonHelper } from './psHelper';

/**
 * Reads "now playing" info on Windows via the GlobalSystemMediaTransportControls
 * (GSMTC) WinRT API, accessed through PowerShell. This avoids a native build
 * step. On non-Windows platforms (or if the call fails) it returns null and the
 * media module is simply skipped.
 *
 * The script runs in a long-lived helper (psHelper.ts): it loads the WinRT
 * projection once, then answers each request line with the current track as
 * one JSON line ({} when nothing is playing). It used to start a fresh
 * PowerShell — and re-read the album art, which nothing displays — on every
 * live-update tick.
 */
const PS_SCRIPT =
  String.raw`
$ErrorActionPreference = 'Stop'
# Force UTF-8 on stdout so non-ASCII track titles (Arabic, Japanese,
# Korean, emoji, etc.) survive the trip to Node. Without this PowerShell
# emits the legacy console codepage (CP1252/OEM) and any character
# outside it becomes '?' BEFORE it ever reaches us. Both the console
# output encoding and $OutputEncoding (pipeline) must be set.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` +
  '`' +
  String.raw`1' })[0]

  Function Await($op, $resultType) {
    $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
  }

  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
} catch {
  [Console]::Out.WriteLine('{"error":"setup"}')
  exit
}

# One request per stdin line -> one JSON line. "QUIT" or EOF (the app
# exited) ends the loop. The session manager is reused between reads and
# fetched again after any error.
$mgr = $null
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ($line -eq 'QUIT') { break }
  $out = '{}'
  try {
    if ($null -eq $mgr) {
      $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    }
    $session = $mgr.GetCurrentSession()
    if ($null -ne $session) {
      $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $playback = $session.GetPlaybackInfo()
      $timeline = $session.GetTimelineProperties()
      $out = [PSCustomObject]@{
        playing  = ($playback.PlaybackStatus.ToString() -eq 'Playing')
        title    = $props.Title
        artist   = $props.Artist
        album    = $props.AlbumTitle
        position = [math]::Round($timeline.Position.TotalSeconds)
        duration = [math]::Round($timeline.EndTime.TotalSeconds)
      } | ConvertTo-Json -Compress
    }
  } catch {
    $mgr = $null
    $out = '{}'
  }
  [Console]::Out.WriteLine($out)
  [Console]::Out.Flush()
}
`;

export class MediaCollector {
  private available = process.platform === 'win32';
  private helper = new PsJsonHelper('media', PS_SCRIPT);

  async collect(): Promise<MediaInfo | null> {
    if (!this.available) return null;
    // The first read also loads the WinRT projection (a second or two).
    const line = await this.helper.request('read', 8000);
    if (!line) return null;
    try {
      const raw = JSON.parse(line);
      if (!raw || !raw.title) return null;
      return {
        playing: !!raw.playing,
        title: String(raw.title || ''),
        artist: String(raw.artist || ''),
        album: String(raw.album || ''),
        position: typeof raw.position === 'number' ? raw.position : undefined,
        duration: typeof raw.duration === 'number' ? raw.duration : undefined,
      };
    } catch {
      return null;
    }
  }

  /** Stop the helper process (app quit). */
  dispose(): void {
    this.helper.dispose();
  }
}
