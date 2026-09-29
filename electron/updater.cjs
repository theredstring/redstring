const { autoUpdater } = require('electron-updater');
const electronLog = require('electron-log');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const https = require('node:https');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const { ipcMain, shell } = require('electron');
const {
  parseShipItStateForBundlePath,
  computeInstallOutcome,
  splitLogTailSinceOffset
} = require('./updater-helpers.cjs');
const { verifyStagedBundle } = require('./updater-bundle-verify.cjs');
const {
  verifyBundleSignature,
  buildDesignatedRequirement,
  DEFAULT_TEAM_ID,
  DEFAULT_BUNDLE_ID
} = require('./updaterSignature.cjs');
const { isSafeExternalUrl } = require('./ipcGuards.cjs');
const {
  pickPreviousRelease,
  pickAssetForArch,
  buildSwapAndRelaunchArgs,
  checkStagedVersion,
  pickPendingZip,
  parseLatestMacYmlSha512,
  deriveTargetBundlePath
} = require('./updater-install-helpers.cjs');

const LOG_PREFIX = '[Updater]';
const RECHECK_INTERVAL_MS = 30 * 60 * 1000;
const MAX_DOWNLOAD_FAILS = 3;
const SHIPIT_TAIL_LINES = 40;

autoUpdater.autoDownload = true;
// On macOS we install via our own swap-and-relaunch helper (see
// 'updater:install' below) because ShipIt is unreliable on macOS 26+.
// Leaving install-on-quit armed lets a late-spawning ShipIt swap the bundle
// (and relaunch) at unpredictable times, racing the user's own relaunch and
// producing a second instance. Keep it for the platforms that use Squirrel.
autoUpdater.autoInstallOnAppQuit = process.platform !== 'darwin';
autoUpdater.logger = electronLog;
autoUpdater.logger.transports.file.level = 'info';

function log(level, ...args) {
  const fn = electronLog[level] || electronLog.info;
  fn(LOG_PREFIX, ...args);
}

// ============================================================
// Mac paths
// ============================================================

function getMacPaths(app) {
  if (process.platform !== 'darwin') return null;
  const home = app.getPath('home');
  const shipItDir = path.join(home, 'Library/Caches/io.redstring.app.ShipIt');
  return {
    shipItDir,
    shipItStateFile: path.join(shipItDir, 'ShipItState.plist'),
    shipItStderrLog: path.join(shipItDir, 'ShipIt_stderr.log'),
    updaterCacheDir: path.join(home, 'Library/Caches/redstring-updater')
  };
}

// ============================================================
// State persistence (uses same JSON pattern as main.cjs storage)
// ============================================================

function getUpdaterStoragePath(app, sessionName) {
  const folderName = sessionName ? `RedstringData_${sessionName}` : 'RedstringData';
  return path.join(app.getPath('userData'), folderName, 'updater.json');
}

function readUpdaterStateSync(app, sessionName) {
  try {
    const filePath = getUpdaterStoragePath(app, sessionName);
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log('error', 'Failed to read updater.json:', error.message);
    }
    return {};
  }
}

function writeUpdaterStateSync(app, sessionName, data) {
  try {
    const filePath = getUpdaterStoragePath(app, sessionName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // Atomic write: this file is persisted right before hard app.exit() in
    // the install path, and a truncated updater.json corrupts install-outcome
    // tracking on the next launch.
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (error) {
    log('error', 'Failed to write updater.json:', error.message);
    return false;
  }
}

// ============================================================
// Mac preflight: validate Squirrel state and clean if desynced
// ============================================================

function wipeStagedState(macPaths, reason) {
  log('warn', 'Preflight: clearing Squirrel + updater caches —', reason);
  try {
    fs.rmSync(macPaths.shipItDir, { recursive: true, force: true });
    fs.rmSync(macPaths.updaterCacheDir, { recursive: true, force: true });
    log('info', 'Preflight: cleaned both caches');
    return { ok: true };
  } catch (rmErr) {
    log('error', 'Preflight: cleanup failed:', rmErr.message);
    return { ok: false, error: rmErr.message };
  }
}

function runMacPreflight(macPaths) {
  if (!macPaths) {
    return { outcome: 'skipped-not-mac' };
  }
  try {
    if (!fs.existsSync(macPaths.shipItStateFile)) {
      return { outcome: 'ok', detail: 'no state file' };
    }
    let parsedBundlePath = null;
    try {
      const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', macPaths.shipItStateFile], {
        timeout: 2000,
        encoding: 'utf-8'
      });
      parsedBundlePath = parseShipItStateForBundlePath(json);
    } catch (parseErr) {
      log('warn', 'Preflight: failed to parse ShipItState.plist:', parseErr.message);
      try {
        fs.rmSync(macPaths.shipItDir, { recursive: true, force: true });
        log('info', 'Preflight: removed corrupted Squirrel state at', macPaths.shipItDir);
      } catch (rmErr) {
        log('error', 'Preflight: failed to remove corrupted Squirrel state:', rmErr.message);
      }
      return { outcome: 'error', detail: 'plist unparseable' };
    }

    if (!parsedBundlePath) {
      return { outcome: 'ok', detail: 'no updateBundleURL in plist' };
    }

    if (!fs.existsSync(parsedBundlePath)) {
      wipeStagedState(macPaths, 'staged bundle directory missing');
      return { outcome: 'cleaned', detail: 'staged bundle missing' };
    }

    // Bundle exists — verify it's actually a complete .app, not a half-extracted
    // husk from a hard refresh / force-kill during stage.
    const verification = verifyStagedBundle(parsedBundlePath);
    if (!verification.valid) {
      log('warn', 'Preflight: staged bundle is incomplete (' + verification.reason + ')');
      wipeStagedState(macPaths, 'incomplete bundle: ' + verification.reason);
      return { outcome: 'cleaned', detail: 'incomplete bundle: ' + verification.reason };
    }

    return { outcome: 'ok', detail: 'staged bundle valid (v' + verification.version + ')' };
  } catch (err) {
    log('error', 'Preflight: unexpected error:', err.message);
    return { outcome: 'error', detail: err.message };
  }
}

// ============================================================
// Mac cleanup: remove orphaned update.XXX dirs after a successful install
// ============================================================

function cleanupOrphanedUpdateDirs(macPaths) {
  if (!macPaths) return [];
  try {
    if (!fs.existsSync(macPaths.shipItDir)) return [];
    const entries = fs.readdirSync(macPaths.shipItDir, { withFileTypes: true });
    const removed = [];
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('update.')) {
        const full = path.join(macPaths.shipItDir, entry.name);
        try {
          fs.rmSync(full, { recursive: true, force: true });
          removed.push(full);
        } catch (rmErr) {
          log('warn', 'Could not remove orphaned dir', full, ':', rmErr.message);
        }
      }
    }
    if (removed.length > 0) {
      log('info', 'Removed', removed.length, 'orphaned update dir(s)');
    }
    return removed;
  } catch (err) {
    log('warn', 'cleanupOrphanedUpdateDirs failed:', err.message);
    return [];
  }
}

// ============================================================
// Manual install: swap a staged .app bundle into place and relaunch
// (bypasses Squirrel.Mac/ShipIt — needed on macOS 26+ where the
// launchd XPC trigger to ShipIt is unreliable)
// ============================================================

// Paths reach the installer script as argv ($1..$5), never spliced into it.
function spawnDetachedSwapAndRelaunch({ stagedBundlePath, targetBundlePath, parentPid }) {
  const logPath = path.join(os.tmpdir(), 'redstring-installer.log');
  const args = buildSwapAndRelaunchArgs({
    stagedBundlePath,
    targetBundlePath,
    parentPid,
    logPath,
    requirement: buildDesignatedRequirement(DEFAULT_TEAM_ID, DEFAULT_BUNDLE_ID)
  });
  const child = spawn('/bin/bash', args, {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  return { logPath, childPid: child.pid };
}

function getTargetBundlePath(app) {
  return deriveTargetBundlePath(app.getPath('exe'));
}

function sha512Base64(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('base64')));
    stream.on('error', reject);
  });
}

// Everything a staged bundle must pass before the swap: structurally complete,
// the version we expect, and signed by us (C-4). Returns { ok, version, reason }.
async function vetStagedBundle(bundlePath, { expectedVersion, currentVersion, allowDowngrade = false }) {
  const structure = verifyStagedBundle(bundlePath);
  if (!structure.valid) return { ok: false, reason: 'incomplete bundle: ' + structure.reason };
  const version = checkStagedVersion({
    stagedVersion: structure.version,
    expectedVersion,
    currentVersion,
    allowDowngrade
  });
  if (!version.ok) return { ok: false, reason: version.reason };
  const signature = await verifyBundleSignature(bundlePath, {
    teamId: DEFAULT_TEAM_ID,
    bundleId: DEFAULT_BUNDLE_ID
  });
  if (!signature.ok) return { ok: false, reason: signature.reason };
  return { ok: true, version: structure.version };
}

// ============================================================
// Debug downgrade: download a previous GitHub release and swap it in
// ============================================================

const GITHUB_OWNER = 'theredstring';
const GITHUB_REPO = 'redstring';

// GET over https only, following at most 5 redirects — and only to https.
function httpsGet(url, { headers = {}, redirectsLeft = 5 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { reject(new Error('Invalid URL')); return; }
    if (parsed.protocol !== 'https:') { reject(new Error('Refusing non-https URL')); return; }
    const req = https.get(parsed, { headers: { 'User-Agent': 'Redstring-Updater', ...headers } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) { reject(new Error('Too many redirects')); return; }
        const next = new URL(res.headers.location, parsed).toString();
        httpsGet(next, { headers, redirectsLeft: redirectsLeft - 1 }).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode + ' from ' + parsed.host));
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
  });
}

async function httpsGetBuffer(url, headers) {
  const res = await httpsGet(url, { headers });
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  });
}

async function httpsGetJson(url) {
  const buf = await httpsGetBuffer(url, { 'Accept': 'application/vnd.github+json' });
  return JSON.parse(buf.toString('utf-8'));
}

async function httpsDownloadToFile(url, destPath) {
  const res = await httpsGet(url);
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    res.pipe(file);
    file.on('finish', () => file.close(() => resolve()));
    file.on('error', reject);
    res.on('error', reject);
  });
}

async function findPreviousRelease(currentVersion) {
  const releases = await httpsGetJson(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=30`);
  if (!Array.isArray(releases)) throw new Error('GitHub releases response was not an array');
  const prev = pickPreviousRelease(releases, currentVersion);
  if (!prev) throw new Error('No older release found on GitHub');
  return prev;
}

// ============================================================
// Mac ShipIt stderr forwarding: tail new bytes into electron-log
// ============================================================

function forwardShipItStderr(macPaths, lastOffset) {
  if (!macPaths) return { newOffset: lastOffset || 0, forwarded: 0 };
  try {
    if (!fs.existsSync(macPaths.shipItStderrLog)) {
      return { newOffset: 0, forwarded: 0 };
    }
    const stat = fs.statSync(macPaths.shipItStderrLog);
    let startOffset = typeof lastOffset === 'number' ? lastOffset : 0;
    if (stat.size < startOffset) {
      startOffset = 0;
    }
    if (stat.size === startOffset) {
      return { newOffset: stat.size, forwarded: 0 };
    }
    const fd = fs.openSync(macPaths.shipItStderrLog, 'r');
    try {
      const buf = Buffer.alloc(stat.size - startOffset);
      fs.readSync(fd, buf, 0, buf.length, startOffset);
      const { lines, newOffset } = splitLogTailSinceOffset(buf, startOffset);
      for (const line of lines) {
        electronLog.info('[ShipIt]', line);
      }
      return { newOffset, forwarded: lines.length };
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    log('warn', 'forwardShipItStderr failed:', err.message);
    return { newOffset: lastOffset || 0, forwarded: 0 };
  }
}

function readShipItStderrTail(macPaths, lineCount) {
  if (!macPaths || !fs.existsSync(macPaths.shipItStderrLog)) return [];
  try {
    const content = fs.readFileSync(macPaths.shipItStderrLog, 'utf-8');
    const lines = content.split('\n').filter((line) => line.length > 0);
    return lines.slice(-Math.max(1, lineCount));
  } catch {
    return [];
  }
}

// ============================================================
// Main init
// ============================================================

// isTrustedSender(event) comes from main (ipcGuards bound to the app origin);
// without one every updater IPC is refused.
function initUpdater({ app, getMainWindow, isDev, isTrustedSender = () => false, stopAgentServer, sessionName }) {
  const macPaths = getMacPaths(app);
  const send = (channel, payload) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  };

  // Mutable runtime state
  let state = readUpdaterStateSync(app, sessionName);
  let availableUpdateInfo = null;
  let pendingUpdateInfo = null;
  let downloadInProgress = false;
  let downloadFailCountThisSession = 0;
  let rechecksTimer = null;

  const currentVersion = app.getVersion();

  // Step 1: detect outcome of last attempt
  const { action, nextState } = computeInstallOutcome({
    currentVersion,
    lastDownloadedVersion: state.lastDownloadedVersion,
    failedInstallCount: state.failedInstallCount
  });
  state.failedInstallCount = nextState.failedInstallCount;
  if (nextState.clearLastDownloaded) {
    log('info', 'Detected successful install of', state.lastDownloadedVersion);
    state.lastDownloadedVersion = null;
    state.lastDownloadedAt = null;
    cleanupOrphanedUpdateDirs(macPaths);
  } else if (action === 'increment') {
    log('warn', 'Detected failed install of', state.lastDownloadedVersion,
      '(attempt', state.failedInstallCount[state.lastDownloadedVersion], ')');
  }

  // Step 2: preflight (skip if we're mid-transition, i.e. last-launched != current)
  // This guards against deleting Squirrel state while another instance is mid-stage.
  const safeForPreflight = !state.lastLaunchedVersion || state.lastLaunchedVersion === currentVersion;
  let preflightResult;
  if (safeForPreflight) {
    preflightResult = runMacPreflight(macPaths);
  } else {
    preflightResult = { outcome: 'skipped-transition', detail: 'version changed since last launch' };
    log('info', 'Preflight skipped:', preflightResult.detail);
  }
  state.lastPreflightOutcome = preflightResult.outcome;
  state.lastPreflightAt = new Date().toISOString();

  // Step 3: forward new ShipIt stderr
  const forward = forwardShipItStderr(macPaths, state.lastSeenShipItOffset);
  state.lastSeenShipItOffset = forward.newOffset;

  // Step 4: update lastLaunchedVersion and persist
  state.lastLaunchedVersion = currentVersion;
  writeUpdaterStateSync(app, sessionName, state);

  // ----- autoUpdater event wiring -----
  autoUpdater.on('checking-for-update', () => {
    log('info', 'Checking for update');
  });

  autoUpdater.on('update-available', (info) => {
    log('info', 'Update available:', info.version);
    availableUpdateInfo = { version: info.version, releaseName: info.releaseName || '' };
    downloadInProgress = true;
    send('updater:update-available', availableUpdateInfo);
  });

  autoUpdater.on('update-not-available', (info) => {
    log('info', 'No update available (current:', currentVersion, ')');
    send('updater:update-not-available', { currentVersion });
  });

  autoUpdater.on('download-progress', (p) => {
    send('updater:download-progress', {
      percent: typeof p?.percent === 'number' ? p.percent : 0
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log('info', 'Update downloaded:', info.version);
    pendingUpdateInfo = { version: info.version, releaseName: info.releaseName || '', downloadedFile: info.downloadedFile || null };
    downloadInProgress = false;
    downloadFailCountThisSession = 0;

    // Persist BEFORE notifying renderer — next launch can detect failed install.
    state.lastDownloadedVersion = info.version;
    state.lastDownloadedAt = new Date().toISOString();
    writeUpdaterStateSync(app, sessionName, state);

    const failsForThisVersion = state.failedInstallCount?.[info.version] || 0;
    send('updater:update-ready', {
      ...pendingUpdateInfo,
      failedInstallCount: failsForThisVersion
    });
  });

  autoUpdater.on('error', (err) => {
    const message = err && err.message ? err.message : String(err);
    const phase = downloadInProgress ? 'download' : 'check';
    log('error', 'autoUpdater error (' + phase + '):', message);

    if (phase === 'download') {
      downloadFailCountThisSession += 1;
      send('updater:error', {
        phase,
        message,
        downloadFails: downloadFailCountThisSession,
        escalated: downloadFailCountThisSession >= MAX_DOWNLOAD_FAILS
      });
    } else {
      send('updater:error', { phase, message });
    }
  });

  // ----- IPC handlers -----
  // Every handler checks its sender: only the app's own top-level page may
  // drive the updater.
  const refuse = (channel) => {
    log('warn', 'Refused ' + channel + ' from untrusted sender');
    return { ok: false, error: 'untrusted sender' };
  };

  // Find the bundle to install: ShipIt's stage if it is the pending version,
  // otherwise our own extraction of the zip electron-updater downloaded (chosen
  // by pending/update-info.json and re-hashed, never by readdir order).
  async function resolveStagedBundle(expectedVersion) {
    try {
      if (fs.existsSync(macPaths.shipItStateFile)) {
        const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', macPaths.shipItStateFile], {
          timeout: 2000, encoding: 'utf-8'
        });
        const shipItPath = parseShipItStateForBundlePath(json);
        if (shipItPath) {
          const structure = verifyStagedBundle(shipItPath);
          if (structure.valid && structure.version === expectedVersion) {
            return shipItPath;
          }
          // A stage left over from an earlier download: never install it.
          log('warn', 'Ignoring ShipIt stage (version ' + (structure.version || structure.reason) + ', expected ' + expectedVersion + ')');
        }
      }
    } catch (err) {
      log('warn', 'Could not read ShipItState.plist:', err.message);
    }

    // ShipIt didn't stage the bundle (unreliable on macOS 26+). Extract the
    // downloaded ZIP ourselves.
    const pendingDir = path.join(macPaths.updaterCacheDir, 'pending');
    let updateInfo = null;
    try {
      updateInfo = JSON.parse(fs.readFileSync(path.join(pendingDir, 'update-info.json'), 'utf-8'));
    } catch (err) {
      log('warn', 'No readable pending/update-info.json:', err.message);
    }
    let zipPath = null;
    const downloaded = pendingUpdateInfo?.downloadedFile || null;
    if (downloaded && path.dirname(downloaded) === pendingDir && fs.existsSync(downloaded)) {
      zipPath = downloaded;
    } else {
      let entries = [];
      try { entries = fs.existsSync(pendingDir) ? fs.readdirSync(pendingDir) : []; } catch { entries = []; }
      const picked = pickPendingZip({ entries, updateInfo, arch: process.arch });
      if (picked) zipPath = path.join(pendingDir, picked);
    }
    if (!zipPath) {
      log('error', 'No unambiguous downloaded ZIP in', pendingDir);
      return null;
    }
    if (updateInfo && typeof updateInfo.sha512 === 'string' && path.basename(zipPath) === updateInfo.fileName) {
      const actual = await sha512Base64(zipPath);
      if (actual !== updateInfo.sha512) {
        log('error', 'Downloaded ZIP hash does not match update-info.json — refusing');
        return null;
      }
    }
    const extractDir = path.join(macPaths.updaterCacheDir, 'manual-extract');
    try {
      // Use rm -rf instead of fs.rmSync — Electron patches fs to treat .asar
      // files as directories, causing rmSync to throw ENOTDIR on app.asar.
      execFileSync('rm', ['-rf', extractDir]);
      fs.mkdirSync(extractDir, { recursive: true });
      execFileSync('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir], { stdio: 'pipe' });
      const apps = fs.readdirSync(extractDir).filter((n) => n.endsWith('.app'));
      if (apps.length !== 1) {
        log('error', 'Expected exactly one .app inside the ZIP, found:', apps.join(', ') || '(none)');
        return null;
      }
      const extracted = path.join(extractDir, apps[0]);
      log('info', 'Self-extracted bundle at:', extracted);
      return extracted;
    } catch (extractErr) {
      log('error', 'Failed to self-extract downloaded ZIP:', extractErr.message);
      return null;
    }
  }

  let installInProgress = false;
  ipcMain.on('updater:install', async (event) => {
    if (!isTrustedSender(event)) { refuse('updater:install'); return; }
    if (installInProgress) return;
    log('info', 'install requested — manual swap (bypassing Squirrel/ShipIt)');
    if (process.platform !== 'darwin') {
      // Other platforms: the standard flow (NSIS verifies the publisher's
      // signature via verifyUpdateCodeSignature before running the installer).
      try { if (typeof stopAgentServer === 'function') stopAgentServer(); } catch {}
      autoUpdater.quitAndInstall(false, true);
      return;
    }

    const expectedVersion = pendingUpdateInfo?.version || null;
    if (!expectedVersion) {
      send('updater:error', { phase: 'install', message: 'No downloaded update to install' });
      return;
    }
    installInProgress = true;
    try {
      // macOS: do the swap ourselves. Squirrel.Mac's ShipIt is unreliable on
      // macOS 26+ (launchd never spawns it). But ShipIt is also what would
      // have checked the new bundle's signature — so we check it here (C-4).
      const stagedBundlePath = await resolveStagedBundle(expectedVersion);
      if (!stagedBundlePath) {
        log('error', 'No staged bundle path — cannot install');
        send('updater:error', {
          phase: 'install',
          message: 'No staged update found — try clearing the cache and re-downloading'
        });
        return;
      }
      const vetted = await vetStagedBundle(stagedBundlePath, { expectedVersion, currentVersion });
      if (!vetted.ok) {
        log('error', 'Staged bundle rejected:', vetted.reason);
        send('updater:error', {
          phase: 'install',
          message: 'Update could not be verified (' + vetted.reason + ') — clear cache and re-download'
        });
        return;
      }
      const targetBundlePath = getTargetBundlePath(app);
      log('info', 'Spawning detached installer:');
      log('info', '  staged: ' + stagedBundlePath);
      log('info', '  target: ' + targetBundlePath);
      try {
        const { logPath, childPid } = spawnDetachedSwapAndRelaunch({
          stagedBundlePath,
          targetBundlePath,
          parentPid: process.pid
        });
        log('info', 'Installer pid=' + childPid + ' log=' + logPath);
      } catch (err) {
        log('error', 'Failed to spawn installer:', err.message);
        send('updater:error', { phase: 'install', message: 'Could not start installer: ' + err.message });
        return;
      }

      try { if (typeof stopAgentServer === 'function') stopAgentServer(); } catch (err) {
        log('warn', 'stopAgentServer threw:', err.message);
      }
      // Give the renderer a tick to handle UI dismissal, then exit.
      app.removeAllListeners('window-all-closed');
      setTimeout(() => app.exit(0), 250);
    } finally {
      installInProgress = false;
    }
  });

  ipcMain.handle('updater:check-pending', (event) => {
    if (!isTrustedSender(event)) return refuse('updater:check-pending');
    if (pendingUpdateInfo) {
      const failsForThisVersion = state.failedInstallCount?.[pendingUpdateInfo.version] || 0;
      return {
        ...pendingUpdateInfo,
        status: 'downloaded',
        failedInstallCount: failsForThisVersion
      };
    }
    if (availableUpdateInfo) {
      return { ...availableUpdateInfo, status: 'available' };
    }
    return null;
  });

  ipcMain.handle('updater:open-releases', (event) => {
    if (!isTrustedSender(event)) return refuse('updater:open-releases');
    const url = 'https://github.com/theredstring/redstring/releases/latest';
    if (isSafeExternalUrl(url)) shell.openExternal(url);
  });

  ipcMain.handle('updater:check-now', async (event) => {
    if (!isTrustedSender(event)) return refuse('updater:check-now');
    try {
      if (downloadInProgress) {
        return { ok: false, error: 'download in progress' };
      }
      log('info', 'Manual check-for-update triggered');
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (err) {
      log('error', 'Manual check failed:', err.message);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('updater:clear-cache', async (event) => {
    if (!isTrustedSender(event)) return refuse('updater:clear-cache');
    if (downloadInProgress) {
      return { ok: false, error: 'download in progress' };
    }
    const removed = [];
    try {
      if (macPaths) {
        if (fs.existsSync(macPaths.shipItDir)) {
          fs.rmSync(macPaths.shipItDir, { recursive: true, force: true });
          removed.push(macPaths.shipItDir);
        }
        if (fs.existsSync(macPaths.updaterCacheDir)) {
          fs.rmSync(macPaths.updaterCacheDir, { recursive: true, force: true });
          removed.push(macPaths.updaterCacheDir);
        }
      }
      state.lastDownloadedVersion = null;
      state.lastDownloadedAt = null;
      state.failedInstallCount = {};
      state.lastSeenShipItOffset = 0;
      writeUpdaterStateSync(app, sessionName, state);
      pendingUpdateInfo = null;
      availableUpdateInfo = null;
      log('info', 'Cache cleared:', removed.join(', ') || '(nothing to remove)');
      send('updater:diagnostics-updated', buildDiagnostics());
      return { ok: true, removedPaths: removed };
    } catch (err) {
      log('error', 'clear-cache failed:', err.message);
      return { ok: false, error: err.message, removedPaths: removed };
    }
  });

  ipcMain.handle('updater:open-log', async (event) => {
    if (!isTrustedSender(event)) return refuse('updater:open-log');
    try {
      const logPath = electronLog.transports.file.getFile().path;
      const result = await shell.openPath(logPath);
      if (result) {
        return { ok: false, error: result };
      }
      return { ok: true, path: logPath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Debug downgrade: fetch the previous GitHub release and install it via
  // the same manual-swap path used by updater:install. Lets us reproduce the
  // auto-update flow on a packaged build without shipping anything.
  //
  // Registered only in development or when the app is started with
  // REDSTRING_ENABLE_DEBUG_DOWNGRADE=1 (the preload exposes it under the same
  // condition). Same gates as a real update: the zip must match the sha512 in
  // that release's latest-mac.yml and the bundle must carry our signature.
  const debugDowngradeEnabled = isDev || process.env.REDSTRING_ENABLE_DEBUG_DOWNGRADE === '1';
  if (debugDowngradeEnabled) ipcMain.handle('updater:debug-downgrade', async (event) => {
    if (!isTrustedSender(event)) return refuse('updater:debug-downgrade');
    if (process.platform !== 'darwin') {
      return { ok: false, error: 'Downgrade is only supported on macOS' };
    }
    if (!app.isPackaged) {
      return { ok: false, error: 'Downgrade only works in packaged builds' };
    }
    try {
      log('info', 'Debug downgrade requested (current ' + currentVersion + ')');
      const prev = await findPreviousRelease(currentVersion);
      log('info', 'Previous release: ' + prev.tag);

      const asset = pickAssetForArch(prev, process.arch);
      if (!asset) {
        const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
        return { ok: false, error: 'No Redstring-mac-' + arch + '.zip asset on ' + prev.tag };
      }
      const manifestAsset = prev.assets.find((a) => a && a.name === 'latest-mac.yml');
      if (!manifestAsset) {
        return { ok: false, error: 'No latest-mac.yml on ' + prev.tag + ' to verify the download against' };
      }
      const expectedSha512 = parseLatestMacYmlSha512(
        (await httpsGetBuffer(manifestAsset.browser_download_url)).toString('utf-8'),
        asset.name
      );
      if (!expectedSha512) {
        return { ok: false, error: 'latest-mac.yml on ' + prev.tag + ' has no sha512 for ' + asset.name };
      }

      const workDir = path.join(macPaths.updaterCacheDir, 'debug-downgrade', prev.tag.replace(/[^A-Za-z0-9._-]/g, '_'));
      execFileSync('rm', ['-rf', workDir]);
      fs.mkdirSync(workDir, { recursive: true });
      const zipPath = path.join(workDir, path.basename(asset.name));

      log('info', 'Downloading ' + asset.browser_download_url);
      send('updater:diagnostics-updated', null);
      await httpsDownloadToFile(asset.browser_download_url, zipPath);
      if ((await sha512Base64(zipPath)) !== expectedSha512) {
        return { ok: false, error: 'Downloaded zip does not match the sha512 in latest-mac.yml' };
      }
      log('info', 'Downloaded and hash-verified, extracting');

      // Use ditto to preserve macOS metadata + code signature
      execFileSync('/usr/bin/ditto', ['-x', '-k', zipPath, workDir], { stdio: 'pipe' });

      const apps = fs.readdirSync(workDir).filter((n) => n.endsWith('.app'));
      if (apps.length !== 1) {
        return { ok: false, error: 'Expected exactly one .app inside the downloaded zip' };
      }
      const stagedBundlePath = path.join(workDir, apps[0]);
      const vetted = await vetStagedBundle(stagedBundlePath, {
        expectedVersion: prev.version,
        currentVersion,
        allowDowngrade: true
      });
      if (!vetted.ok) {
        return { ok: false, error: 'Downloaded bundle rejected: ' + vetted.reason };
      }
      log('info', 'Bundle verified as v' + vetted.version);

      const targetBundlePath = getTargetBundlePath(app);
      log('info', 'Spawning installer: ' + stagedBundlePath + ' -> ' + targetBundlePath);
      const { logPath, childPid } = spawnDetachedSwapAndRelaunch({
        stagedBundlePath,
        targetBundlePath,
        parentPid: process.pid
      });
      log('info', 'Installer pid=' + childPid + ' log=' + logPath);

      try { if (typeof stopAgentServer === 'function') stopAgentServer(); } catch {}
      app.removeAllListeners('window-all-closed');
      setTimeout(() => app.exit(0), 500);
      return { ok: true, version: vetted.version, tag: prev.tag };
    } catch (err) {
      log('error', 'Debug downgrade failed:', err.message);
      return { ok: false, error: err.message };
    }
  });

  function buildDiagnostics() {
    const squirrel = macPaths ? {
      stateFileExists: fs.existsSync(macPaths.shipItStateFile),
      stateFilePath: macPaths.shipItStateFile,
      parsedUpdateBundleURL: null,
      updateBundleExists: false,
      cacheDirExists: fs.existsSync(macPaths.shipItDir),
      cacheDirPath: macPaths.shipItDir
    } : null;

    if (squirrel && squirrel.stateFileExists) {
      try {
        const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', macPaths.shipItStateFile], {
          timeout: 2000,
          encoding: 'utf-8'
        });
        squirrel.parsedUpdateBundleURL = parseShipItStateForBundlePath(json);
        squirrel.updateBundleExists = squirrel.parsedUpdateBundleURL
          ? fs.existsSync(squirrel.parsedUpdateBundleURL)
          : false;
        if (squirrel.updateBundleExists) {
          const verification = verifyStagedBundle(squirrel.parsedUpdateBundleURL);
          squirrel.bundleValid = verification.valid;
          squirrel.bundleReason = verification.valid ? null : verification.reason;
          squirrel.bundleVersion = verification.valid ? verification.version : null;
        } else {
          squirrel.bundleValid = false;
          squirrel.bundleReason = 'directory missing';
          squirrel.bundleVersion = null;
        }
      } catch {
        squirrel.parsedUpdateBundleURL = '(unparseable)';
        squirrel.bundleValid = false;
        squirrel.bundleReason = 'plist unparseable';
        squirrel.bundleVersion = null;
      }
    }

    return {
      appVersion: currentVersion,
      platform: process.platform,
      isPackaged: app.isPackaged,
      availableUpdateInfo,
      pendingUpdateInfo,
      persistedState: state,
      squirrel,
      updaterCacheDirExists: macPaths ? fs.existsSync(macPaths.updaterCacheDir) : false,
      updaterCacheDirPath: macPaths ? macPaths.updaterCacheDir : null,
      logFilePath: electronLog.transports.file.getFile().path,
      shipItStderrTail: readShipItStderrTail(macPaths, SHIPIT_TAIL_LINES)
    };
  }

  ipcMain.handle('updater:get-diagnostics', (event) => {
    if (!isTrustedSender(event)) return refuse('updater:get-diagnostics');
    return buildDiagnostics();
  });

  // ----- Dev-only simulator -----
  // Lets you exercise every toast/card state from devtools console without
  // a real GitHub release. Only registered in dev mode.
  //
  // Usage from renderer devtools:
  //   await window.electron.updater.__devSimulate('update-available', { version: '0.9.9' })
  //   await window.electron.updater.__devSimulate('download-progress', { percent: 42 })
  //   await window.electron.updater.__devSimulate('update-downloaded', { version: '0.9.9', failedInstallCount: 0 })
  //   await window.electron.updater.__devSimulate('error', { phase: 'download', downloadFails: 3, escalated: true, message: 'fake' })
  //   await window.electron.updater.__devSimulate('error', { phase: 'install', message: 'fake install fail' })
  //   await window.electron.updater.__devSimulate('update-not-available')
  //   await window.electron.updater.__devSimulate('reset')   // clears in-memory state
  if (isDev) {
    log('info', 'Dev simulator IPC handler registered — use window.electron.updater.__devSimulate(...)');
    ipcMain.handle('updater:__dev:simulate', (event, kind, payload) => {
      if (!isTrustedSender(event)) return refuse('updater:__dev:simulate');
      const data = payload || {};
      switch (kind) {
        case 'update-available':
          availableUpdateInfo = { version: data.version || '0.9.9', releaseName: data.releaseName || '' };
          downloadInProgress = true;
          send('updater:update-available', availableUpdateInfo);
          return { ok: true };
        case 'update-not-available':
          send('updater:update-not-available', { currentVersion });
          return { ok: true };
        case 'download-progress':
          send('updater:download-progress', { percent: typeof data.percent === 'number' ? data.percent : 50 });
          return { ok: true };
        case 'update-downloaded':
          pendingUpdateInfo = { version: data.version || '0.9.9', releaseName: data.releaseName || '' };
          downloadInProgress = false;
          send('updater:update-ready', {
            ...pendingUpdateInfo,
            failedInstallCount: typeof data.failedInstallCount === 'number' ? data.failedInstallCount : 0
          });
          return { ok: true };
        case 'error':
          send('updater:error', {
            phase: data.phase || 'download',
            message: data.message || 'simulated error',
            downloadFails: typeof data.downloadFails === 'number' ? data.downloadFails : 1,
            escalated: !!data.escalated
          });
          return { ok: true };
        case 'reset':
          availableUpdateInfo = null;
          pendingUpdateInfo = null;
          downloadInProgress = false;
          downloadFailCountThisSession = 0;
          return { ok: true };
        default:
          return { ok: false, error: `unknown simulate kind: ${kind}` };
      }
    });
  }

  // ----- Start checks -----
  if (!isDev) {
    try {
      autoUpdater.checkForUpdates();
    } catch (err) {
      log('error', 'initial checkForUpdates threw:', err.message);
    }
    rechecksTimer = setInterval(() => {
      if (downloadInProgress) return;
      try {
        autoUpdater.checkForUpdates();
      } catch (err) {
        log('warn', 'periodic checkForUpdates threw:', err.message);
      }
    }, RECHECK_INTERVAL_MS);
  } else {
    log('info', 'Dev mode — auto-updater idle');
  }

  return {
    openDiagnostics: () => send('updater:open-diagnostics', null),
    shutdown: () => {
      if (rechecksTimer) clearInterval(rechecksTimer);
    }
  };
}

module.exports = {
  initUpdater,
  // Exported for unit tests
  parseShipItStateForBundlePath,
  computeInstallOutcome,
  splitLogTailSinceOffset
};
