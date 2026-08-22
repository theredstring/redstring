import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.redstring.app',
  appName: 'Redstring',
  webDir: 'dist',
  ios: {
    contentInset: 'always'
  }
};

export default config;
