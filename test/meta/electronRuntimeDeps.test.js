import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  mainProcessRequires, runtimeClosure, nodeModulesPatterns,
} from '../../scripts/electron-runtime-deps.mjs';

const ROOT = path.resolve(__dirname, '../..');
const builderFiles = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'electron-builder.json'), 'utf8')).files;

describe('what the desktop app packs from node_modules (scripts/electron-runtime-deps.mjs)', () => {
  it('is exactly what the main process loads, so nothing it needs is left out', () => {
    // A stale list either ships a package nobody loads or, worse, leaves out
    // one the main process requires, and the app fails at launch.
    const expected = nodeModulesPatterns(runtimeClosure(mainProcessRequires()));
    const actual = builderFiles().filter((p) => /^!?node_modules\//.test(p));
    expect(actual, 'run: npm run electron:runtime-deps').toEqual(expected);
  });

  it('finds the main process\'s own requires', () => {
    const roots = mainProcessRequires();
    expect(roots).toContain('electron-updater');
    expect(roots).toContain('electron-log');
    expect(roots).not.toContain('electron');
  });

  it('keeps packages electron-builder lifts out of a nested node_modules', () => {
    // electron-updater carries its own fs-extra and semver; the packed app has
    // them at the top of node_modules, where only a pattern by name reaches.
    const names = runtimeClosure(['electron-updater']);
    expect(names).toEqual(expect.arrayContaining(['fs-extra', 'semver', 'builder-util-runtime']));
  });

  it('the agent server bundle carries its own packages', () => {
    // It is packed as one file and never loads from node_modules; an
    // --external would need that package in the list above.
    const { scripts } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(scripts['bundle:agent']).toMatch(/--bundle/);
    expect(scripts['bundle:agent']).not.toMatch(/--external|--packages=external/);
  });
});
