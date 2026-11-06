#!/usr/bin/env node
/**
 * Lets `electron:dev` answer staging's "Open in App" links (redstring-dev://).
 *
 * macOS only hands a scheme to an app whose Info.plist declares it, and the dev
 * app runs as node_modules' plain Electron.app. So this declares the scheme there
 * and tells Launch Services. It only touches node_modules, and installing or
 * upgrading Electron undoes it, which is why `electron:dev` runs it every time.
 * Never stops the dev app from starting.
 *
 *   node scripts/register-dev-link.cjs [path/to/Electron.app]
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const SCHEME = 'redstring-dev';
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

const run = (command, ...args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function declaredIn(plist) {
  try {
    return run('/usr/libexec/PlistBuddy', '-c', 'Print :CFBundleURLTypes', plist).includes(SCHEME);
  } catch {
    return false; // No URL types at all yet.
  }
}

function register(appPath) {
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  if (!declaredIn(plist)) {
    run('/usr/libexec/PlistBuddy',
      '-c', 'Add :CFBundleURLTypes array',
      '-c', 'Add :CFBundleURLTypes:0 dict',
      '-c', 'Add :CFBundleURLTypes:0:CFBundleURLName string Redstring Dev Link',
      '-c', 'Add :CFBundleURLTypes:0:CFBundleURLSchemes array',
      '-c', `Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string ${SCHEME}`,
      plist);
    // The plist is part of the bundle's signature. It's ad hoc anyway; redo it.
    run('codesign', '--force', '--sign', '-', appPath);
  }
  run(LSREGISTER, '-f', appPath);
}

if (process.platform === 'darwin') {
  try {
    const appPath = process.argv[2]
      || path.resolve(require('electron'), '..', '..', '..');
    register(appPath);
  } catch (error) {
    console.warn(`[register-dev-link] Staging's Open in App won't reach this dev app: ${error.message}`);
  }
}
