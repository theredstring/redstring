// Pure helpers for the manual-install / debug-downgrade paths in updater.cjs.
// Extracted so they can be unit-tested without electron / electron-updater.

function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const ai = pa[i] || 0;
    const bi = pb[i] || 0;
    if (ai < bi) return -1;
    if (ai > bi) return 1;
  }
  return 0;
}

function pickPreviousRelease(releases, currentVersion) {
  if (!Array.isArray(releases)) return null;
  const candidates = releases
    .filter((r) => r && !r.draft && !r.prerelease && typeof r.tag_name === 'string')
    .map((r) => ({
      tag: r.tag_name,
      version: r.tag_name.replace(/^v/, ''),
      assets: Array.isArray(r.assets) ? r.assets : []
    }))
    .filter((r) => compareVersions(r.version, currentVersion) < 0)
    .sort((a, b) => compareVersions(b.version, a.version));
  return candidates[0] || null;
}

function pickAssetForArch(release, arch) {
  if (!release || !Array.isArray(release.assets)) return null;
  const wantArch = arch === 'arm64' ? 'arm64' : 'x64';
  const expectedName = 'Redstring-mac-' + wantArch + '.zip';
  return release.assets.find((a) => a && a.name === expectedName) || null;
}

// Generates the bash script that performs the bundle swap and relaunch.
//
// The script contains NO caller-supplied data: the staged path, target path,
// parent pid, log path and signature requirement arrive as positional
// arguments ("$1".."$5") and are always quoted, so a bundle path such as
// `/tmp/$(touch x).app` stays a literal path. Spawn it with
// buildSwapAndRelaunchArgs(). `openCommand` is a fixed program chosen by code
// (tests swap in a stub), never data.
//
// With `verify` on (the default), the swapped-in bundle is re-checked by
// codesign against the pinned requirement BEFORE its quarantine attribute is
// removed; a failure (or a missing requirement) restores the previous app.
// The quarantine strip only ever runs on a bundle that passed.
function buildSwapAndRelaunchScript({
  openCommand = 'open',
  maxWaitSeconds = 30,
  verify = true
} = {}) {
  const waitSeconds = Math.max(0.5, Number(maxWaitSeconds) || 30);
  const waitIterations = Math.max(1, Math.ceil(waitSeconds * 2));
  const verifyBlock = verify ? `
if [ -z "$REQUIREMENT" ] || ! /usr/bin/codesign --verify --deep --strict -R "=$REQUIREMENT" "$TARGET"; then
  echo "ERROR: swapped-in bundle failed signature check — restoring old"
  rm -rf "$TARGET"
  if [ -d "$TRASH" ]; then mv "$TRASH" "$TARGET"; fi
  exit 1
fi
` : '';
  return `
set -u
STAGED="$1"
TARGET="$2"
PARENT_PID="$3"
LOG_PATH="$4"
REQUIREMENT="\${5:-}"
case "$PARENT_PID" in (''|*[!0-9]*) echo "ERROR: bad parent pid" >&2; exit 1;; esac
exec >> "$LOG_PATH" 2>&1
echo "[$(date '+%Y-%m-%dT%H:%M:%S')] installer start parent=$PARENT_PID"
echo "  staged=$STAGED"
echo "  target=$TARGET"

for i in $(seq 1 ${waitIterations}); do
  kill -0 "$PARENT_PID" 2>/dev/null || break
  sleep 0.5
done
if kill -0 "$PARENT_PID" 2>/dev/null; then
  echo "ERROR: parent $PARENT_PID still alive after ${waitSeconds}s, aborting"
  exit 1
fi
sleep 0.5

if [ ! -d "$STAGED" ]; then
  echo "ERROR: staged bundle missing at $STAGED"
  exit 1
fi

TARGET_DIR=$(dirname "$TARGET")
TARGET_BASE=$(basename "$TARGET")
TRASH="$TARGET_DIR/.$TARGET_BASE.old.$$"

if [ -d "$TARGET" ]; then
  if ! mv "$TARGET" "$TRASH"; then
    echo "ERROR: could not move old bundle aside (permissions?)"
    exit 1
  fi
fi

if ! mv "$STAGED" "$TARGET"; then
  echo "ERROR: could not move staged bundle into place — restoring old"
  if [ -d "$TRASH" ]; then mv "$TRASH" "$TARGET"; fi
  exit 1
fi
${verifyBlock}
rm -rf "$TRASH" 2>/dev/null || true
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true

if ! ${openCommand} "$TARGET"; then
  echo "ERROR: open command failed"
  exit 1
fi
echo "[$(date '+%Y-%m-%dT%H:%M:%S')] installer done"
`;
}

// argv for spawn('/bin/bash', argv). "--" becomes $0; the data follows as
// $1..$5 and is never parsed as shell.
function buildSwapAndRelaunchArgs({
  stagedBundlePath,
  targetBundlePath,
  parentPid,
  logPath,
  requirement = '',
  openCommand,
  maxWaitSeconds,
  verify
}) {
  if (!stagedBundlePath || !targetBundlePath || !parentPid || !logPath) {
    throw new Error('buildSwapAndRelaunchArgs: missing required argument');
  }
  if (!Number.isInteger(Number(parentPid)) || Number(parentPid) <= 0) {
    throw new Error('buildSwapAndRelaunchArgs: parentPid must be a positive integer');
  }
  const script = buildSwapAndRelaunchScript({ openCommand, maxWaitSeconds, verify });
  return ['-c', script, '--', String(stagedBundlePath), String(targetBundlePath), String(parentPid), String(logPath), String(requirement || '')];
}

// A staged/extracted bundle may only be installed when it is exactly the
// version electron-updater announced and newer than what is running. Stops a
// stale ShipIt stage or a leftover zip from installing an older build.
function checkStagedVersion({ stagedVersion, expectedVersion, currentVersion, allowDowngrade = false }) {
  if (!stagedVersion) return { ok: false, reason: 'staged bundle has no version' };
  if (!expectedVersion) return { ok: false, reason: 'no pending update version to compare against' };
  if (compareVersions(stagedVersion, expectedVersion) !== 0) {
    return { ok: false, reason: 'staged version ' + stagedVersion + ' does not match pending ' + expectedVersion };
  }
  if (!allowDowngrade && compareVersions(stagedVersion, currentVersion) <= 0) {
    return { ok: false, reason: 'staged version ' + stagedVersion + ' is not newer than ' + currentVersion };
  }
  return { ok: true, reason: null };
}

// Pick the downloaded zip in electron-updater's pending dir without relying on
// readdir order: the file named by pending/update-info.json wins; otherwise
// exactly one zip for this arch; anything ambiguous returns null.
function pickPendingZip({ entries, updateInfo, arch }) {
  const zips = (Array.isArray(entries) ? entries : [])
    .filter((n) => typeof n === 'string' && n.endsWith('.zip') && !/[\\/]/.test(n));
  const named = updateInfo && typeof updateInfo.fileName === 'string' ? updateInfo.fileName : null;
  if (named && zips.includes(named)) return named;
  const wantArch = arch === 'arm64' ? 'arm64' : 'x64';
  const forArch = zips.filter((n) => n.endsWith('-' + wantArch + '.zip'));
  return forArch.length === 1 ? forArch[0] : null;
}

// The base64 sha512 electron-builder recorded for `fileName` in a
// latest-mac.yml. A purpose-built reader: the file is machine-written and only
// the `files:` entries matter.
function parseLatestMacYmlSha512(text, fileName) {
  if (typeof text !== 'string' || !fileName) return null;
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const url = line.match(/^\s*-\s*url:\s*(.+?)\s*$/);
    if (url) { current = url[1].replace(/^['"]|['"]$/g, ''); continue; }
    if (/^\S/.test(line)) { current = null; continue; }
    const sha = line.match(/^\s+sha512:\s*(.+?)\s*$/);
    if (sha && current === fileName) return sha[1].replace(/^['"]|['"]$/g, '');
  }
  return null;
}

// Walks up 3 levels from an exe path to derive the .app bundle path.
// Pulled out so tests don't need a real electron app instance.
function deriveTargetBundlePath(exePath) {
  if (typeof exePath !== 'string' || exePath.length === 0) return null;
  const parts = exePath.split('/');
  if (parts.length < 4) return null;
  return parts.slice(0, parts.length - 3).join('/');
}

module.exports = {
  compareVersions,
  pickPreviousRelease,
  pickAssetForArch,
  buildSwapAndRelaunchScript,
  buildSwapAndRelaunchArgs,
  checkStagedVersion,
  pickPendingZip,
  parseLatestMacYmlSha512,
  deriveTargetBundlePath
};
