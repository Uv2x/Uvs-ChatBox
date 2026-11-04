import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.uvschatbox.mobile',
  appName: "Uv's Chat Box",
  webDir: 'dist',
  ios: {
    // Chatbox OSC is plain UDP over the local WiFi; no special config needed.
    contentInset: 'always',
  },
};

export default config;
