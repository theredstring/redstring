// Verifies a staged .app bundle has the minimum parts required for ShipIt
// to swap it in successfully. Catches half-extracted bundles left behind by
// hard refresh (Cmd+Shift+R) or force-kill during Squirrel.Mac's stage step —
// Squirrel won't re-stage on its own if the directory exists, so we have to
// detect and clean these stale-but-present states explicitly.
//
// Lives in its own file so it can be unit-tested without loading electron.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function verifyStagedBundle(bundlePath) {
  if (!bundlePath) return { valid: false, reason: 'no path' };
  try {
    if (!fs.existsSync(bundlePath)) return { valid: false, reason: 'bundle dir missing' };
    const contentsDir = path.join(bundlePath, 'Contents');
    if (!fs.existsSync(contentsDir)) return { valid: false, reason: 'Contents/ missing' };

    const infoPlist = path.join(contentsDir, 'Info.plist');
    if (!fs.existsSync(infoPlist)) return { valid: false, reason: 'Info.plist missing' };
    const infoStat = fs.statSync(infoPlist);
    if (infoStat.size === 0) return { valid: false, reason: 'Info.plist empty' };

    const macOsDir = path.join(contentsDir, 'MacOS');
    if (!fs.existsSync(macOsDir)) return { valid: false, reason: 'Contents/MacOS/ missing' };
    let macOsEntries = [];
    try {
      macOsEntries = fs.readdirSync(macOsDir);
    } catch {
      return { valid: false, reason: 'Contents/MacOS/ unreadable' };
    }
    if (macOsEntries.length === 0) return { valid: false, reason: 'Contents/MacOS/ empty' };

    let hasNonEmptyExecutable = false;
    for (const name of macOsEntries) {
      try {
        const stat = fs.statSync(path.join(macOsDir, name));
        if (stat.isFile() && stat.size > 0) {
          hasNonEmptyExecutable = true;
          break;
        }
      } catch { /* skip */ }
    }
    if (!hasNonEmptyExecutable) return { valid: false, reason: 'no executable in Contents/MacOS/' };

    // Verify Info.plist parses and has a version. Catches mid-write truncation.
    try {
      const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', infoPlist], {
        timeout: 2000,
        encoding: 'utf-8'
      });
      const parsed = JSON.parse(json);
      if (!parsed || typeof parsed.CFBundleShortVersionString !== 'string') {
        return { valid: false, reason: 'Info.plist missing CFBundleShortVersionString' };
      }
      return { valid: true, version: parsed.CFBundleShortVersionString };
    } catch (err) {
      return { valid: false, reason: 'Info.plist unparseable: ' + err.message };
    }
  } catch (err) {
    return { valid: false, reason: 'verification threw: ' + err.message };
  }
}

module.exports = { verifyStagedBundle };
