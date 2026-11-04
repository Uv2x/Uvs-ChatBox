import { spawn } from 'child_process';
import type { MediaInfo } from '../shared/types';

/**
 * Reads "now playing" info on Windows via the GlobalSystemMediaTransportControls
 * (GSMTC) WinRT API, accessed through a short PowerShell script. This avoids a
 * native build step. On non-Windows platforms (or if the call fails) it returns
 * null and the media module is simply skipped.
 *
 * The PowerShell snippet loads the WinRT projection, awaits the async session
 * manager, and prints the current track's title/artist/status as JSON.
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
  `1' })[0]

  Function Await($op, $resultType) {
    $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
  }

  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
  $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  $session = $mgr.GetCurrentSession()
  if ($null -eq $session) { Write-Output 'null'; exit }

  $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $playback = $session.GetPlaybackInfo()
  $timeline = $session.GetTimelineProperties()
  $status = $playback.PlaybackStatus.ToString()

  # Thumbnail: SMTC ships a IRandomAccessStreamReference for the track
  # cover art when the source provides one (Spotify does). We open the
  # stream, read the bytes synchronously, and base64-encode them so the
  # renderer can drop the result straight into an <img src="data:...">.
  # Wrapped in try/catch because not every track / source has a thumbnail.
  $thumb = $null
  try {
    if ($props.Thumbnail) {
      [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
      $streamRef = $props.Thumbnail
      $stream = Await ($streamRef.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
      if ($stream -and $stream.Size -gt 0 -and $stream.Size -lt 524288) { # cap at 512 KB
        $reader = New-Object Windows.Storage.Streams.DataReader $stream
        Await ($reader.LoadAsync([uint32]$stream.Size)) ([uint32]) | Out-Null
        $bytes = New-Object byte[] $stream.Size
        $reader.ReadBytes($bytes)
        $thumb = [Convert]::ToBase64String($bytes)
      }
    }
  } catch { $thumb = $null }

  $obj = [PSCustomObject]@{
    playing        = ($status -eq 'Playing')
    title          = $props.Title
    artist         = $props.Artist
    album          = $props.AlbumTitle
    position       = [math]::Round($timeline.Position.TotalSeconds)
    duration       = [math]::Round($timeline.EndTime.TotalSeconds)
    thumbnailBase64 = $thumb
  }
  $obj | ConvertTo-Json -Compress
} catch {
  Write-Output 'null'
}
`;

export class MediaCollector {
  private available = process.platform === 'win32';

  async collect(): Promise<MediaInfo | null> {
    if (!this.available) return null;
    try {
      const json = await this.runPowerShell();
      const trimmed = json.trim();
      if (!trimmed || trimmed === 'null') return null;
      const raw = JSON.parse(trimmed);
      if (!raw || !raw.title) return null;
      return {
        playing: !!raw.playing,
        title: String(raw.title || ''),
        artist: String(raw.artist || ''),
        album: String(raw.album || ''),
        position: typeof raw.position === 'number' ? raw.position : undefined,
        duration: typeof raw.duration === 'number' ? raw.duration : undefined,
        thumbnailBase64:
          typeof raw.thumbnailBase64 === 'string' && raw.thumbnailBase64.length > 0
            ? raw.thumbnailBase64
            : undefined,
      };
    } catch {
      return null;
    }
  }

  private runPowerShell(): Promise<string> {
    return new Promise((resolve, reject) => {
      const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT], {
        windowsHide: true,
      });
      // Collect raw Buffer chunks and decode ONCE at the end. Decoding
      // each chunk separately (d.toString()) can split a multi-byte UTF-8
      // sequence across two chunks and corrupt the character at the
      // boundary — which would garble Arabic / CJK titles even after the
      // PowerShell-side UTF-8 fix.
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => {
        ps.kill();
        reject(new Error('media query timeout'));
      }, 4000);

      ps.stdout.on('data', (d: Buffer) => chunks.push(d));
      ps.stderr.on('data', () => {
        /* ignore — failures resolve to 'null' */
      });
      ps.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      ps.on('close', () => {
        clearTimeout(timer);
        const out = Buffer.concat(chunks).toString('utf-8');
        resolve(out || 'null');
      });
    });
  }
}
