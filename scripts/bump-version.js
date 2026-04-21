import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkgPath = path.join(__dirname, '../package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const currentVersion = pkg.version;

const arg = (process.argv[2] || 'patch').trim();

function computeNextVersion(current, spec) {
  const explicit = spec.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-[a-zA-Z0-9.]+)?$/);
  if (explicit) return spec.replace(/^v/, '');

  const parts = current.split('.').map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`Cannot parse current version "${current}"`);
  }
  let [major, minor, patch] = parts;
  switch (spec) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Unknown bump type "${spec}". Use patch, minor, major, or an explicit x.y.z.`);
  }
}

const newVersion = computeNextVersion(currentVersion, arg);

if (newVersion !== currentVersion) {
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`[bump-version] package.json ${currentVersion} → ${newVersion}`);
} else {
  console.log(`[bump-version] package.json already at ${newVersion}`);
}

const readmePath = path.join(__dirname, '../README.md');
const readmeContent = fs.readFileSync(readmePath, 'utf8');
const updatedReadme = readmeContent.replace(
  /(!\[App Version\]\(https:\/\/img\.shields\.io\/badge\/version-v)[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.]+)?(-blue\))/g,
  `$1${newVersion}$2`
);

if (readmeContent !== updatedReadme) {
  fs.writeFileSync(readmePath, updatedReadme);
  console.log(`[bump-version] README.md → v${newVersion}`);
} else {
  console.log(`[bump-version] README.md already at v${newVersion}`);
}

try {
  execSync('npm install --package-lock-only --silent', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
  });
  console.log(`[bump-version] package-lock.json refreshed`);
} catch (err) {
  console.warn(`[bump-version] Could not refresh package-lock.json: ${err.message}`);
}
