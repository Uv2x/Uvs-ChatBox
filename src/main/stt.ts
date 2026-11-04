// Speech-to-Text via the Windows UWP SpeechRecognizer.
//
// Same architectural pattern as media.ts and battery.ts: we spawn a single
// long-lived PowerShell process that uses WinRT to talk to
// Windows.Media.SpeechRecognition.SpeechRecognizer (the engine Cortana uses).
// Each recognized phrase is written as one JSON line on stdout, which we
// parse and re-emit as events.
//
// Why a long-lived spawn instead of one-shot per phrase: WinRT projection +
// SpeechRecognizer constraint compilation costs ~1 second per spawn, which
// would make dictation feel laggy between phrases. With one persistent
// process we just RecognizeAsync in a loop; gap between phrases is the
// engine's own EndSilenceTimeout (~1s).
//
// Lifecycle:
//   start()  -> spawn PowerShell, emit 'ready' when constraint compile done,
//               then emit 'phrase' for every recognized utterance.
//   stop()   -> SIGKILL the PowerShell. The next spawn starts cleanly.
//
// Errors are surfaced as 'error' events. The recognizer doesn't throw to the
// caller — it logs and emits.

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import log from 'electron-log';

// We use the UWP SpeechRecognizer (Windows.Media.SpeechRecognition) — the
// same engine Cortana uses. It's noticeably more accurate than the older
// System.Speech / SAPI engine. The trade-off: UWP refuses to run unless the
// user has accepted Windows's "Online speech recognition" privacy policy at
// least once (even for offline recognition).
//
// If that exception fires, we surface a special 'needs-privacy-accept' event
// so the renderer can show a one-click "Open Windows Speech Settings" link.
// After the user toggles the setting on once, future runs work without further
// interaction (the acceptance is sticky — they can turn the toggle back off).
const PS_HARNESS = String.raw`
$ErrorActionPreference = 'Stop'
function Emit($obj) {
  $json = $obj | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation' + [char]96 + '1'
    })[0]
  function Await($op, $resultType) {
    $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
  }

  [Windows.Media.SpeechRecognition.SpeechRecognizer, Windows.Media, ContentType = WindowsRuntime] | Out-Null
  [Windows.Media.SpeechRecognition.SpeechRecognitionResult, Windows.Media, ContentType = WindowsRuntime] | Out-Null

  $rec = New-Object Windows.Media.SpeechRecognition.SpeechRecognizer
  $compile = Await ($rec.CompileConstraintsAsync()) ([Windows.Media.SpeechRecognition.SpeechRecognitionCompilationResult])
  if ([int]$compile.Status -ne 0) {
    Emit @{ event = 'fatal'; message = "constraint compile failed: $($compile.Status)" }
    exit 1
  }

  $rec.Timeouts.InitialSilenceTimeout = [TimeSpan]::FromSeconds(6)
  $rec.Timeouts.EndSilenceTimeout     = [TimeSpan]::FromMilliseconds(800)
  $rec.Timeouts.BabbleTimeout         = [TimeSpan]::FromSeconds(2)

  try {
    Emit @{ event = 'ready'; language = $rec.CurrentLanguage.LanguageTag }
  } catch {
    Emit @{ event = 'ready' }
  }

  while ($true) {
    try {
      $result = Await ($rec.RecognizeAsync()) ([Windows.Media.SpeechRecognition.SpeechRecognitionResult])
      $status = [int]$result.Status
      $text   = if ($result.Text) { $result.Text } else { '' }
      $conf   = [int]$result.Confidence
      Emit @{ event = 'phrase'; text = $text; status = $status; confidence = $conf }
    } catch {
      $msg = $_.Exception.Message
      # Detect the well-known "speech privacy policy was not accepted" error
      # text and emit it as a structured event the renderer can render with a
      # one-click fix link.
      if ($msg -match 'speech privacy policy' -or $msg -match '8004503A' -or $msg -match '0x8004503A') {
        Emit @{ event = 'needs-privacy-accept'; message = $msg }
        # Privacy policy is fatal until accepted — exiting tells the renderer
        # to flip the button back to idle.
        exit 0
      }
      Emit @{ event = 'error'; message = $msg }
      Start-Sleep -Milliseconds 250
    }
  }
} catch {
  $msg = $_.Exception.Message
  if ($msg -match 'speech privacy policy' -or $msg -match '8004503A' -or $msg -match '0x8004503A') {
    Emit @{ event = 'needs-privacy-accept'; message = $msg }
  } else {
    Emit @{ event = 'fatal'; message = $msg }
  }
}
`;

export type SttEvent =
  | { event: 'ready'; language?: string }
  | { event: 'phrase'; text: string; status: number; confidence: number }
  | { event: 'error'; message: string }
  | { event: 'fatal'; message: string }
  | { event: 'needs-privacy-accept'; message: string };

export class SpeechRecognizer extends EventEmitter {
  private ps: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuf = '';

  /** True if a recognition loop is currently active. */
  isRunning(): boolean {
    return this.ps !== null;
  }

  start(): void {
    if (this.ps) return; // already running
    if (process.platform !== 'win32') {
      log.warn('[stt] only supported on Windows');
      this.emit('event', {
        event: 'fatal',
        message: 'Speech-to-text is only supported on Windows.',
      } as SttEvent);
      return;
    }

    log.info('[stt] starting recognizer');
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_HARNESS], {
      windowsHide: true,
    });
    this.ps = ps;

    ps.stdout.on('data', (d) => this.handleStdout(d.toString()));
    ps.stderr.on('data', (d) => {
      log.warn('[stt] stderr:', d.toString().trim().slice(0, 400));
    });
    ps.on('error', (e) => {
      log.error('[stt] spawn error:', e);
      this.emit('event', { event: 'fatal', message: e.message } as SttEvent);
      this.ps = null;
    });
    ps.on('close', (code) => {
      log.info(`[stt] PowerShell exited code=${code}`);
      this.ps = null;
      this.stdoutBuf = '';
      this.emit('stopped');
    });
  }

  stop(): void {
    if (!this.ps) return;
    log.info('[stt] stopping recognizer');
    try {
      this.ps.kill();
    } catch {
      /* ignore */
    }
    this.ps = null;
    this.stdoutBuf = '';
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuf += chunk;
    const lines = this.stdoutBuf.split(/\r?\n/);
    // Last element may be a partial line; hold for next chunk.
    this.stdoutBuf = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (!line.startsWith('{')) continue;
      try {
        const ev = JSON.parse(line) as SttEvent;
        this.emit('event', ev);
      } catch (e) {
        log.warn('[stt] could not parse stdout line:', line.slice(0, 200), e);
      }
    }
  }
}
