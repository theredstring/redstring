import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.redstring.app',
  appName: 'Redstring',
  webDir: 'dist',
  ios: {
    // The page owns its safe areas now: viewport-fit=cover lets it paint into
    // them and <body> holds them as padding, so the header colour fills the
    // Dynamic Island and home-indicator bands. Leaving this as 'always' would
    // have WebKit inset the scroll view on top of that padding — the insets
    // applied twice, with an opaque native band still showing above the page.
    contentInset: 'never'
  }
};

export default config;
