import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read package.json
const pkgPath = path.join(__dirname, '../package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const newVersion = pkg.version;

// Update README.md
const readmePath = path.join(__dirname, '../README.md');
const readmeContent = fs.readFileSync(readmePath, 'utf8');

// Replace the shield badge pattern ![App Version](https://img.shields.io/badge/version-vX.Y.Z-blue)
const updatedReadme = readmeContent.replace(
  /(!\[App Version\]\(https:\/\/img\.shields\.io\/badge\/version-v)[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.]+)?(-blue\))/g,
  `$1${newVersion}$2`
);

if (readmeContent !== updatedReadme) {
  fs.writeFileSync(readmePath, updatedReadme);
  console.log(`[bump-version] Updated README.md to v${newVersion}`);
} else {
  console.log(`[bump-version] README.md is already up to date with v${newVersion}`);
}
