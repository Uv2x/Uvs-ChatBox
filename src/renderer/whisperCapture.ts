// Browser-side audio capture for the Whisper STT engine.
//
// We use the WebAudio AudioContext with sampleRate: 16000 so the browser does
// the resampling for us (most sound cards run at 44.1k or 48k). A
// ScriptProcessorNode buffers 4096-sample frames; we convert Float32 → Int16
// and stream them to main via IPC. ScriptProcessorNode is deprecated but
// still works in Electron's Chromium and is far simpler than wiring an
// AudioWorklet for a single, well-defined task.
//
// Lifecycle:
//   start() — getUserMedia, create context, hook up the processor.
//   stop()  — close everything; safe to call multiple times.

export class WhisperCapture {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private proc: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private running = false;

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        // Whisper needs 16 kHz mono. We REQUEST 16k but the browser may
        // override; the AudioContext does the final resample for us.
        sampleRate: 16000,
        channelCount: 1,
      },
    });
    const ctx = new AudioContext({ sampleRate: 16000 });
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);

    proc.onaudioprocess = (e) => {
      const ch = e.inputBuffer.getChannelData(0);
      // Float32 [-1..1] -> Int16 [-32768..32767].
      const int16 = new Int16Array(ch.length);
      for (let i = 0; i < ch.length; i++) {
        const s = Math.max(-1, Math.min(1, ch[i] ?? 0));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      // Send as a transferable so we don't copy in the IPC step.
      window.chatbox.whisperPushPcm(int16.buffer);
    };

    source.connect(proc);
    proc.connect(ctx.destination);

    this.ctx = ctx;
    this.source = source;
    this.proc = proc;
    this.stream = stream;
    this.running = true;
  }

  stop(): void {
    if (!this.running) return;
    try {
      this.proc?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.source?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    try {
      this.stream?.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    this.proc = null;
    this.source = null;
    this.ctx = null;
    this.stream = null;
    this.running = false;
  }
}
