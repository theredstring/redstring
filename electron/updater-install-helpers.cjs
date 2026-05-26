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
// Pure string builder — no side effects. The `openCommand` override exists
// for tests that don't want to actually launch a .app.
function buildSwapAndRelaunchScript({
  stagedBundlePath,
  targetBundlePath,
  parentPid,
  logPath,
  openCommand = 'open',
  maxWaitSeconds = 30
}) {
  if (!stagedBundlePath || !targetBundlePath || !parentPid || !logPath) {
    throw new Error('buildSwapAndRelaunchScript: missing required argument');
  }
  const waitIterations = Math.max(1, Math.ceil(maxWaitSeconds * 2));
  return `
set -u
exec >> "${logPath}" 2>&1
echo "[$(date '+%Y-%m-%dT%H:%M:%S')] installer start parent=${parentPid}"
echo "  staged=${stagedBundlePath}"
echo "  target=${targetBundlePath}"

for i in $(seq 1 ${waitIterations}); do
  kill -0 ${parentPid} 2>/dev/null || break
  sleep 0.5
done
if kill -0 ${parentPid} 2>/dev/null; then
  echo "ERROR: parent ${parentPid} still alive after ${maxWaitSeconds}s, aborting"
  exit 1
fi
sleep 0.5

if [ ! -d "${stagedBundlePath}" ]; then
  echo "ERROR: staged bundle missing at ${stagedBundlePath}"
  exit 1
fi

TARGET_DIR=$(dirname "${targetBundlePath}")
TARGET_BASE=$(basename "${targetBundlePath}")
TRASH="$TARGET_DIR/.$TARGET_BASE.old.$$"

if [ -d "${targetBundlePath}" ]; then
  if ! mv "${targetBundlePath}" "$TRASH"; then
    echo "ERROR: could not move old bundle aside (permissions?)"
    exit 1
  fi
fi

if ! mv "${stagedBundlePath}" "${targetBundlePath}"; then
  echo "ERROR: could not move staged bundle into place — restoring old"
  if [ -d "$TRASH" ]; then mv "$TRASH" "${targetBundlePath}"; fi
  exit 1
fi

rm -rf "$TRASH" 2>/dev/null || true
xattr -dr com.apple.quarantine "${targetBundlePath}" 2>/dev/null || true

if ! ${openCommand} "${targetBundlePath}"; then
  echo "ERROR: open command failed"
  exit 1
fi
echo "[$(date '+%Y-%m-%dT%H:%M:%S')] installer done"
`;
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
  deriveTargetBundlePath
};
