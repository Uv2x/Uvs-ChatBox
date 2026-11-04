import type {
  AppSettings,
  MediaInfo,
  SystemStats,
  AudioStatus,
  BatteryStatus,
  QuestAdbState,
  AfkState,
  InstanceEvent,
  OscTelemetry,
  Action,
  ActionResult,
  AppState,
  HistoryEntry,
  ConnStatus,
  RelayConfig,
  RelayStatus,
  SttPushEvent,
  UpdateStatus,
} from '../shared/types';

export interface LiveUpdatePayload {
  media: MediaInfo | null;
  stats: SystemStats | null;
  audio: AudioStatus | null;
  battery: BatteryStatus | null;
  afk: AfkState | null;
  instance: InstanceEvent | null;
  telemetry: OscTelemetry | null;
  time: string;
  preview: string;
}

/**
 * Renderer-side TypeScript surface of `window.chatbox`.
 *
 * NOTE: this is hand-maintained and MUST stay in sync with the actual
 * preload API in `src/main/preload.ts` (which exports `ChatboxApi`
 * structurally via `typeof api`). Adding an IPC method = add it in both
 * places. We can't import directly because the renderer tsconfig
 * doesn't include src/main, and pulling preload.ts in would drag in
 * `electron`'s contextBridge type, which doesn't belong in renderer code.
 */
export interface ChatboxApi {
  getSettings(): Promise<AppSettings>;
  saveSettings(s: AppSettings): Promise<boolean>;
  resetSettings(): Promise<AppSettings>;
  sendMessage(text: string): Promise<boolean>;
  setTyping(typing: boolean): Promise<boolean>;
  clearChatbox(): Promise<boolean>;
  startLive(): Promise<boolean>;
  stopLive(): Promise<boolean>;
  testConnection(): Promise<boolean>;
  getBattery(): Promise<BatteryStatus & { diag?: string; adb?: QuestAdbState }>;
  questBatteryRescan(): Promise<BatteryStatus & { diag?: string; adb?: QuestAdbState }>;
  getTelemetry(): Promise<OscTelemetry>;
  runAction(a: Action): Promise<ActionResult>;
  runActions(a: Action[]): Promise<ActionResult>;
  runMacro(id: string): Promise<ActionResult>;
  runTimeline(id: string): Promise<ActionResult>;
  stopTimeline(): Promise<boolean>;
  switchProfile(id: string): Promise<boolean>;
  setStatus(id: string): Promise<ActionResult>;
  getState(): Promise<AppState>;
  getHistory(): Promise<HistoryEntry[]>;
  undoLast(): Promise<ActionResult>;
  registerHotkeys(): Promise<boolean>;
  checkUpdate(): Promise<UpdateStatus>;
  applyUpdate(): Promise<boolean>;
  onLiveUpdate(cb: (payload: LiveUpdatePayload) => void): () => void;
  onStateUpdate(cb: (s: AppState) => void): () => void;
  onConnUpdate(cb: (c: ConnStatus) => void): () => void;
  onHotkeyFired(cb: (info: { type: string; id: string }) => void): () => void;
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void;
  getRelayConfig(): Promise<RelayConfig>;
  saveRelayConfig(c: RelayConfig): Promise<boolean>;
  forceRelayAdvance(): Promise<boolean>;
  onRelayStatus(cb: (s: RelayStatus) => void): () => void;
  // VRCOSC-ported.
  getWeather(): Promise<{
    available: boolean;
    city: string;
    tempC: number;
    tempF: number;
    code: number;
    desc: string;
    windKph: number;
    fetchedAt: number;
  }>;
  pingHost(
    ip: string,
  ): Promise<{ ok: boolean; reachable: boolean; ms: number | null; error?: string }>;
  vrNotifyTest(): Promise<{ ok: boolean; error?: string; debug?: string }>;
  getLyricsStatus(): Promise<{ available: boolean; error: string; retryInSec: number }>;
  pillTest(method: string): Promise<{ ok: boolean; error?: string; holdSec?: number }>;
  systemCheck(): Promise<import('../shared/types').HealthCheck[]>;
  installUpdate(): Promise<boolean>;
  getDiscordStatus(): Promise<{ state: string; error: string }>;
  onDiscordStatus(cb: (s: { state: string; error: string }) => void): () => void;
  // Whisper STT.
  whisperPushPcm(buf: ArrayBuffer): Promise<boolean>;
  whisperDownload(modelChoice: string): Promise<{ ok: boolean; path?: string; error?: string }>;
  whisperStatus(): Promise<{ engine: 'uwp' | 'whisper'; running: boolean; cfg: unknown }>;
  onWhisperDownload(
    cb: (e: {
      event: string;
      model?: string;
      got?: number;
      total?: number;
      path?: string;
      message?: string;
    }) => void,
  ): () => void;
  startSpeechToText(): Promise<boolean>;
  stopSpeechToText(): Promise<boolean>;
  onSpeechEvent(cb: (e: SttPushEvent) => void): () => void;
  openWindowsSetting(name: string): Promise<boolean>;
  getMediaNow(): Promise<MediaInfo | null>;
  getAfkNow(): Promise<AfkState>;
  exportSettings(): Promise<{ ok: boolean; reason?: string; path?: string }>;
  importSettings(): Promise<{ ok: boolean; reason?: string; path?: string }>;
  setLoginItem(enabled: boolean): Promise<boolean>;
  getLoginItem(): Promise<boolean>;
  quitApp(): Promise<boolean>;
  scheduleAdd(text: string, fireAt: number): Promise<{ ok: boolean; id?: string; reason?: string }>;
  scheduleRemove(id: string): Promise<boolean>;
  scheduleList(): Promise<Array<{ id: string; text: string; fireAt: number }>>;

  // Global pause switch
  getPaused(): Promise<boolean>;
  setPaused(paused: boolean): Promise<boolean>;
  onPauseUpdate(cb: (paused: boolean) => void): () => void;

  // VRChat output-log snapshot
  getVrchatLog(): Promise<{
    inWorld: boolean;
    world: string;
    instanceType: string;
    playerCount: number;
    lastJoin: string;
    lastLeave: string;
    avatar: string;
    lastUpdate: number;
  }>;

  // Settings backups
  listBackups(): Promise<{ name: string; mtime: number; size: number }[]>;
  restoreBackup(name: string): Promise<boolean>;

  // Unpin all
  clearPin(): Promise<boolean>;
  // Toggle / remove individual pin slots
  togglePin(key: string, text: string): Promise<boolean>;
  removePin(key: string): Promise<boolean>;

  // ---- AI ----
  aiTest(): Promise<{
    ok: boolean;
    data?: { model: string; usage: { input: number; output: number } };
    error?: string;
  }>;
  aiGenerateLine(ctx: {
    status?: string;
    music?: { title: string; artist: string } | null;
    world?: string;
  }): Promise<{ ok: boolean; data?: string; error?: string }>;
  aiPersonaReply(ctx: {
    state: string;
    minutesIdle: number;
  }): Promise<{ ok: boolean; data?: string; error?: string }>;
  aiCleanupStt(raw: string): Promise<{ ok: boolean; data?: string; error?: string }>;

  // ---- Auto-translate ----
  translateText(
    text: string,
    targetLang: string,
  ): Promise<{ ok: boolean; data?: string; error?: string }>;
}

declare global {
  interface Window {
    chatbox: ChatboxApi;
  }
}
