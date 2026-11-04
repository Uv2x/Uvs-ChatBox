// Preload script: the *only* bridge between the sandboxed renderer and the
// main process. Every function exposed here is a narrow, typed wrapper around
// a specific IPC channel — no raw ipcRenderer, no node APIs leak to the page.
//
// Security notes:
//   - contextIsolation:true + nodeIntegration:false are enforced in main.ts.
//   - We expose a single object on `window.chatbox` (see global.d.ts).
//   - Event subscribers return an unsubscribe function so listeners can be
//     cleaned up on React unmount.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '../shared/types';
import type {
  AppSettings,
  BatteryStatus,
  OscTelemetry,
  Action,
  ActionResult,
  AppState,
  HistoryEntry,
  ConnStatus,
  LivePayload,
  UpdateStatus,
  HealthCheck,
  RelayConfig,
  RelayStatus,
  SttPushEvent,
  MediaInfo,
  AfkState,
} from '../shared/types';

const sub = <T>(channel: string, cb: (payload: T) => void): (() => void) => {
  const handler = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};

const api = {
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.GET_SETTINGS),
  saveSettings: (s: AppSettings): Promise<boolean> => ipcRenderer.invoke(IPC.SAVE_SETTINGS, s),
  resetSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.RESET_SETTINGS),
  sendMessage: (text: string): Promise<boolean> => ipcRenderer.invoke(IPC.SEND_MESSAGE, text),
  setTyping: (typing: boolean): Promise<boolean> => ipcRenderer.invoke(IPC.SET_TYPING, typing),
  clearChatbox: (): Promise<boolean> => ipcRenderer.invoke(IPC.CLEAR_CHATBOX),
  startLive: (): Promise<boolean> => ipcRenderer.invoke(IPC.START_LIVE),
  stopLive: (): Promise<boolean> => ipcRenderer.invoke(IPC.STOP_LIVE),
  testConnection: (): Promise<boolean> => ipcRenderer.invoke(IPC.TEST_CONNECTION),
  getBattery: (): Promise<BatteryStatus & { diag?: string }> => ipcRenderer.invoke(IPC.GET_BATTERY),
  getTelemetry: (): Promise<OscTelemetry> => ipcRenderer.invoke(IPC.GET_TELEMETRY),

  // ---- Phase 1 automation ----
  runAction: (a: Action): Promise<ActionResult> => ipcRenderer.invoke(IPC.RUN_ACTION, a),
  runActions: (a: Action[]): Promise<ActionResult> => ipcRenderer.invoke(IPC.RUN_ACTIONS, a),
  runMacro: (id: string): Promise<ActionResult> => ipcRenderer.invoke(IPC.RUN_MACRO, id),
  runTimeline: (id: string): Promise<ActionResult> => ipcRenderer.invoke(IPC.RUN_TIMELINE, id),
  stopTimeline: (): Promise<boolean> => ipcRenderer.invoke(IPC.STOP_TIMELINE),
  switchProfile: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.SWITCH_PROFILE, id),
  setStatus: (id: string): Promise<ActionResult> => ipcRenderer.invoke(IPC.SET_STATUS, id),
  getState: (): Promise<AppState> => ipcRenderer.invoke(IPC.GET_STATE),
  getHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke(IPC.GET_HISTORY),
  undoLast: (): Promise<ActionResult> => ipcRenderer.invoke(IPC.UNDO_LAST),
  registerHotkeys: (): Promise<boolean> => ipcRenderer.invoke(IPC.REGISTER_HOTKEYS),
  checkUpdate: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.CHECK_UPDATE),
  applyUpdate: (): Promise<boolean> => ipcRenderer.invoke(IPC.APPLY_UPDATE),

  onLiveUpdate: (cb: (p: LivePayload) => void) => sub<LivePayload>(IPC.LIVE_UPDATE, cb),
  onStateUpdate: (cb: (s: AppState) => void) => sub<AppState>(IPC.STATE_UPDATE, cb),
  onConnUpdate: (cb: (c: ConnStatus) => void) => sub<ConnStatus>(IPC.CONN_UPDATE, cb),
  onHotkeyFired: (cb: (info: { type: string; id: string }) => void) =>
    sub<{ type: string; id: string }>(IPC.HOTKEY_FIRED, cb),
  onUpdateStatus: (cb: (s: UpdateStatus) => void) => sub<UpdateStatus>(IPC.UPDATE_STATUS, cb),

  // ---- Status relay ----
  getRelayConfig: (): Promise<RelayConfig> => ipcRenderer.invoke(IPC.RELAY_GET_CONFIG),
  saveRelayConfig: (c: RelayConfig): Promise<boolean> =>
    ipcRenderer.invoke(IPC.RELAY_SAVE_CONFIG, c),
  forceRelayAdvance: (): Promise<boolean> => ipcRenderer.invoke(IPC.RELAY_FORCE_ADVANCE),
  onRelayStatus: (cb: (s: RelayStatus) => void) => sub<RelayStatus>(IPC.RELAY_STATUS, cb),

  // ---- VRCOSC-ported: Weather ----
  getWeather: (): Promise<{
    available: boolean;
    city: string;
    tempC: number;
    tempF: number;
    code: number;
    desc: string;
    windKph: number;
    fetchedAt: number;
  }> => ipcRenderer.invoke(IPC.WEATHER_GET),

  pingHost: (
    ip: string,
  ): Promise<{ ok: boolean; reachable: boolean; ms: number | null; error?: string }> =>
    ipcRenderer.invoke(IPC.NET_PING, { ip }),
  vrNotifyTest: (): Promise<{ ok: boolean; error?: string; debug?: string }> =>
    ipcRenderer.invoke(IPC.VR_NOTIFY_TEST),
  getLyricsStatus: (): Promise<{ available: boolean; error: string; retryInSec: number }> =>
    ipcRenderer.invoke(IPC.LYRICS_STATUS),
  pillTest: (method: string): Promise<{ ok: boolean; error?: string; holdSec?: number }> =>
    ipcRenderer.invoke(IPC.PILL_TEST, { method }),
  systemCheck: (): Promise<HealthCheck[]> => ipcRenderer.invoke(IPC.SYSTEM_CHECK),
  installUpdate: (): Promise<boolean> => ipcRenderer.invoke(IPC.INSTALL_UPDATE),
  getDiscordStatus: (): Promise<{ state: string; error: string }> =>
    ipcRenderer.invoke(IPC.DISCORD_GET_STATUS),
  onDiscordStatus: (cb: (s: { state: string; error: string }) => void) =>
    sub<{ state: string; error: string }>(IPC.DISCORD_STATUS, cb),
  questBatteryRescan: (): Promise<BatteryStatus & { diag?: string; adb?: unknown }> =>
    ipcRenderer.invoke(IPC.QUEST_BATTERY_RESCAN),

  // ---- Whisper STT ----
  whisperPushPcm: (buf: ArrayBuffer): Promise<boolean> =>
    ipcRenderer.invoke(IPC.WHISPER_PUSH_PCM, buf),
  whisperDownload: (modelChoice: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.WHISPER_DOWNLOAD, { modelChoice }),
  whisperStatus: (): Promise<{ engine: 'uwp' | 'whisper'; running: boolean; cfg: unknown }> =>
    ipcRenderer.invoke(IPC.WHISPER_STATUS),
  onWhisperDownload: (
    cb: (e: {
      event: string;
      model?: string;
      got?: number;
      total?: number;
      path?: string;
      message?: string;
    }) => void,
  ) =>
    sub<{
      event: string;
      model?: string;
      got?: number;
      total?: number;
      path?: string;
      message?: string;
    }>(IPC.WHISPER_DOWNLOAD_EVENT, cb),

  // ---- Speech to text ----
  startSpeechToText: (): Promise<boolean> => ipcRenderer.invoke(IPC.STT_START),
  stopSpeechToText: (): Promise<boolean> => ipcRenderer.invoke(IPC.STT_STOP),
  onSpeechEvent: (cb: (e: SttPushEvent) => void) => sub<SttPushEvent>(IPC.STT_EVENT, cb),

  // Open a whitelisted ms-settings:* URI (e.g. "privacy-speech").
  openWindowsSetting: (name: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.OPEN_WINDOWS_SETTING, name),

  /** One-shot current-media snapshot. Returns null if nothing is playing. */
  getMediaNow: (): Promise<MediaInfo | null> => ipcRenderer.invoke(IPC.GET_MEDIA_NOW),

  /** One-shot AFK / idle snapshot. */
  getAfkNow: (): Promise<AfkState> => ipcRenderer.invoke(IPC.GET_AFK_NOW),

  // ---- Settings export / import + login item + quit ----
  exportSettings: (): Promise<{ ok: boolean; reason?: string; path?: string }> =>
    ipcRenderer.invoke(IPC.EXPORT_SETTINGS),
  importSettings: (): Promise<{ ok: boolean; reason?: string; path?: string }> =>
    ipcRenderer.invoke(IPC.IMPORT_SETTINGS),
  setLoginItem: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC.SET_LOGIN_ITEM, enabled),
  getLoginItem: (): Promise<boolean> => ipcRenderer.invoke(IPC.GET_LOGIN_ITEM),
  quitApp: (): Promise<boolean> => ipcRenderer.invoke(IPC.QUIT_APP),

  // ---- Scheduled send-later queue ----
  scheduleAdd: (
    text: string,
    fireAt: number,
  ): Promise<{ ok: boolean; id?: string; reason?: string }> =>
    ipcRenderer.invoke(IPC.SCHEDULE_ADD, { text, fireAt }),
  scheduleRemove: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.SCHEDULE_REMOVE, id),
  scheduleList: (): Promise<Array<{ id: string; text: string; fireAt: number }>> =>
    ipcRenderer.invoke(IPC.SCHEDULE_LIST),

  // ---- Global pause (panic switch) ----
  getPaused: (): Promise<boolean> => ipcRenderer.invoke(IPC.PAUSE_GET),
  setPaused: (paused: boolean): Promise<boolean> => ipcRenderer.invoke(IPC.PAUSE_SET, paused),
  onPauseUpdate: (cb: (p: boolean) => void) => sub<boolean>(IPC.PAUSE_UPDATE, cb),

  // ---- VRChat output-log snapshot ----
  getVrchatLog: (): Promise<{
    inWorld: boolean;
    world: string;
    instanceType: string;
    playerCount: number;
    lastJoin: string;
    lastLeave: string;
    avatar: string;
    lastUpdate: number;
  }> => ipcRenderer.invoke(IPC.VRCHAT_LOG_GET),

  // ---- Settings backups ----
  listBackups: (): Promise<{ name: string; mtime: number; size: number }[]> =>
    ipcRenderer.invoke(IPC.BACKUPS_LIST),
  restoreBackup: (name: string): Promise<boolean> => ipcRenderer.invoke(IPC.BACKUPS_RESTORE, name),

  // ---- Pin/unpin manual sent message ----
  clearPin: (): Promise<boolean> => ipcRenderer.invoke('pin:clear'),
  /** Toggle a pin slot. Adds if absent, removes if present. Resolves to
   *  the new on/off state of the key. */
  togglePin: (key: string, text: string): Promise<boolean> =>
    ipcRenderer.invoke('pin:toggle', { key, text }),
  /** Remove a single pin slot by key (no-op if absent). */
  removePin: (key: string): Promise<boolean> => ipcRenderer.invoke('pin:remove', key),

  // ---- AI ----
  aiTest: (): Promise<{
    ok: boolean;
    data?: { model: string; usage: { input: number; output: number } };
    error?: string;
  }> => ipcRenderer.invoke(IPC.AI_TEST),
  aiGenerateLine: (ctx: {
    status?: string;
    music?: { title: string; artist: string } | null;
    world?: string;
  }): Promise<{ ok: boolean; data?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.AI_GENERATE_LINE, ctx),
  aiPersonaReply: (ctx: {
    state: string;
    minutesIdle: number;
  }): Promise<{ ok: boolean; data?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.AI_PERSONA_REPLY, ctx),
  aiCleanupStt: (raw: string): Promise<{ ok: boolean; data?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.AI_CLEANUP_STT, raw),

  // ---- Auto-translate ----
  translateText: (
    text: string,
    targetLang: string,
  ): Promise<{ ok: boolean; data?: string; error?: string }> =>
    ipcRenderer.invoke('translate:text', { text, targetLang }),
};

// Expose on `window.chatbox` to match the renderer's existing global.d.ts.
contextBridge.exposeInMainWorld('chatbox', api);

export type ChatboxApi = typeof api;
