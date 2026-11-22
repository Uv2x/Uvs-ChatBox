// Unit tests for main-process logic. They run under plain Node against the
// compiled output (`npm test` builds first). A tiny stand-in replaces the
// 'electron' module for our own code only; everything else is real.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist', 'main');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'uvs-test-'));
const fake = { idleSec: 0 };
const electron = {
  app: { getPath: () => userData, getVersion: () => '0.0.0-test' },
  powerMonitor: { getSystemIdleTime: () => fake.idleSec },
};
const realLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'electron' && parent && parent.filename && parent.filename.startsWith(dist)) {
    return electron;
  }
  return realLoad.call(this, request, parent, ...rest);
};

const { AfkDetector } = require(path.join(dist, 'afk.js'));
const { toDevices } = require(path.join(dist, 'vrBattery.js'));
const { SettingsStore, isReplaceableSettingsFile } = require(path.join(dist, 'settings.js'));
const { OscManager } = require(path.join(dist, 'osc.js'));

// ---------------------------------------------------------------- AFK
const ON = { available: true, activityLevel: 1, hmdOnHead: true };
const OFF = { available: true, activityLevel: 3, hmdOnHead: false };
const NONE = { available: false, activityLevel: -1, hmdOnHead: false };
const THRESHOLD = 180;

test('AFK detection', async (t) => {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  t.after(() => {
    Date.now = realNow;
  });
  const hmd = { current: NONE };
  const detector = () => new AfkDetector({ poll: async () => ({ ...hmd.current }) });
  const afk = async (d) => (await d.poll(THRESHOLD)).afk;

  await t.test('PCVR: never AFK while the headset is worn', async () => {
    const d = detector();
    hmd.current = ON;
    fake.idleSec = 7200;
    assert.equal(await afk(d), false);
    d.setVrchatAfk(false);
    now += 11 * 60_000; // the old 10-minute expiry turned this into AFK
    assert.equal(await afk(d), false);
  });

  await t.test('PCVR: AFK once the headset has been off longer than the threshold', async () => {
    const d = detector();
    hmd.current = ON;
    fake.idleSec = 7200;
    await afk(d);
    hmd.current = OFF;
    now += 60_000;
    assert.equal(await afk(d), false);
    now += 3 * 60_000;
    assert.equal(await afk(d), true);
    hmd.current = ON;
    assert.equal(await afk(d), false);
  });

  await t.test("VRChat's AFK flag wins, and is forgotten when VRChat closes", async () => {
    const d = detector();
    hmd.current = ON;
    fake.idleSec = 0;
    d.setVrchatAfk(true);
    assert.equal(await afk(d), true);
    d.setVrchatAfk(false);
    assert.equal(await afk(d), false);
    d.setVrchatAfk(true);
    d.resetVrchat();
    assert.equal(await afk(d), false);
  });

  await t.test('desktop play (VRMode 0) with SteamVR open uses keyboard/mouse idle', async () => {
    const d = detector();
    hmd.current = OFF;
    d.setVrchatVrMode(0);
    fake.idleSec = 5;
    assert.equal(await afk(d), false);
    fake.idleSec = 600;
    assert.equal(await afk(d), true);
  });

  await t.test('VR without a working headset sensor relies on VRChat only', async () => {
    const d = detector();
    hmd.current = OFF;
    d.setVrchatVrMode(1);
    fake.idleSec = 3600;
    assert.equal(await afk(d), false);
  });

  await t.test('no SteamVR: plain keyboard/mouse idle', async () => {
    const d = detector();
    hmd.current = NONE;
    fake.idleSec = 60;
    assert.equal(await afk(d), false);
    fake.idleSec = 600;
    assert.equal(await afk(d), true);
  });

  await t.test('standalone Quest target: only VRChat counts', async () => {
    const d = detector();
    d.setRemoteTarget(true);
    fake.idleSec = 3600;
    assert.equal(await afk(d), false);
    d.setVrchatAfk(true);
    assert.equal(await afk(d), true);
  });

  await t.test("sources 'idle' and 'vrchat' do what they say", async () => {
    let d = detector();
    d.setSource('idle');
    hmd.current = ON;
    fake.idleSec = 600;
    d.setVrchatAfk(false);
    assert.equal(await afk(d), true);
    d = detector();
    d.setSource('vrchat');
    hmd.current = NONE;
    fake.idleSec = 3600;
    assert.equal(await afk(d), false);
  });
});

// ---------------------------------------------------------------- battery
test('battery devices get readable names in a stable order', () => {
  const tracker = (serial, percent) => ({
    kind: 'tracker',
    role: 0,
    serial,
    percent,
    charging: false,
  });
  const roles = new Map([
    ['human://waist', 'TrackerRole_Waist'],
    ['human://left_foot', 'TrackerRole_LeftFoot'],
    ['human://left_hand', 'TrackerRole_Handed,TrackedControllerRole_LeftHand'],
  ]);
  const names = toDevices(
    [
      { kind: 'controller', role: 2, serial: 'R', percent: 80, charging: true },
      tracker('human://WAIST', 66),
      tracker('human://LEFT_FOOT', 70),
      tracker('human://RIGHT_KNEE', 63), // no role saved: falls back to the serial
      tracker('human://LEFT_HAND', 50),
      { kind: 'hmd', role: 0, serial: 'H', percent: 95, charging: false },
      { kind: 'controller', role: 1, serial: 'L', percent: 15, charging: false },
      tracker('LHR-1', 50),
      tracker('LHR-2', 40),
    ],
    roles,
  ).map((d) => d.name);
  assert.deepEqual(names, [
    'Headset',
    'Left controller',
    'Right controller',
    'Waist',
    'Left foot',
    'Right knee',
    'Left hand',
    'Tracker 1',
    'Tracker 2',
  ]);
});

// ---------------------------------------------------------------- settings
test('loading old settings drops removed features', async () => {
  fs.writeFileSync(
    path.join(userData, 'settings.json'),
    JSON.stringify({
      macros: [{ id: 'm' }],
      timelines: [],
      chatboxPill: true,
      pillMethod: 'vrcosc',
      relay: { enabled: false },
      ui: { streamer: true, compact: false },
      statuses: [
        { id: 'available', label: 'Available', icon: '🟢' },
        { id: 'streaming', label: 'Streaming', icon: '🔴', text: '🔴 Live' },
      ],
      state: {
        currentStatusId: 'streaming',
        pinnedItems: [{ key: 'status:streaming', text: '🔴 Live' }],
      },
      activePersonaId: 'streamer',
      ai: {
        enabled: false,
        apiKey: '',
        model: 'claude-opus-4-7',
        features: { generateLine: true },
        wakeWord: 'uvy',
        persona: '',
      },
      autoResponder: { enabled: false, afterMin: 5, onMute: false, message: 'brb' },
      featureToggles: { macros: true, history: true },
    }),
  );
  const s = await new SettingsStore().load();
  for (const key of ['macros', 'timelines', 'chatboxPill', 'pillMethod', 'relay']) {
    assert.ok(!(key in s), `${key} should be gone`);
  }
  assert.ok(!('streamer' in s.ui));
  assert.ok(!s.statuses.some((st) => st.id === 'streaming'));
  assert.equal(s.state.currentStatusId, 'available');
  assert.deepEqual(s.state.pinnedItems, []);
  assert.equal(s.activePersonaId, 'chill');
  assert.equal(s.ai.model, 'claude-opus-5-5');
  assert.ok(!('features' in s.ai) && !('wakeWord' in s.ai));
  assert.ok(!('afterMin' in s.autoResponder));
  assert.ok(!('macros' in s.featureToggles));
  assert.equal(s.featureToggles.history, true);
});

test('Export settings only ever replaces a previous settings export', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uvs-export-'));
  const file = (name, body) => {
    const p = path.join(dir, name);
    if (body !== undefined) fs.writeFileSync(p, body);
    return p;
  };
  assert.equal(await isReplaceableSettingsFile(file('new.json')), true);
  assert.equal(
    await isReplaceableSettingsFile(
      file('old-export.json', JSON.stringify({ osc: {}, modules: [] })),
    ),
    true,
  );
  assert.equal(
    await isReplaceableSettingsFile(
      file('package.json', JSON.stringify({ name: 'x', version: '1.0.0' })),
    ),
    false,
  );
  assert.equal(await isReplaceableSettingsFile(file('notes.json', 'not json')), false);
});

// ---------------------------------------------------------------- chatbox text
test('chatbox text is clamped to 144 UTF-16 units without splitting an emoji', () => {
  assert.equal(OscManager.clampTo('😀'.repeat(100), 144), '😀'.repeat(72));
  assert.equal(OscManager.clampTo('a' + '😀'.repeat(100), 144).length, 143);
  assert.equal(OscManager.clampTo('short', 144), 'short');
});
