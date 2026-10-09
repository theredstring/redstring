/**
 * Settings as a file (Settings → Data → Settings): an allowlist of
 * preferences, never keys, tokens, universes or save guards.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PREFERENCE_KEYS, buildSettingsFile, readSettingsFile } from '../../src/services/devicePreferences.js';

const ROOT = path.resolve(__dirname, '../..');

const allSource = () => {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(name) && !full.endsWith('devicePreferences.js')) out.push(fs.readFileSync(full, 'utf8'));
    }
  };
  walk(path.join(ROOT, 'src'));
  return out.join('\n');
};

describe('settings file', () => {
  beforeEach(() => localStorage.clear());

  it('carries the preferences and nothing else on the device', () => {
    localStorage.setItem('redstring_grid_mode', 'always');
    localStorage.setItem('redstring_auto_save_mode', 'off');
    localStorage.setItem('redstring_ai_api_profiles', '[{"key":"sk-secret"}]');
    localStorage.setItem('github_access_token', 'rsenc:v1:abc');
    localStorage.setItem('unified_universes_list', '[]');
    localStorage.setItem('redstring-savecoord-guard:ideas', '{}');

    const file = buildSettingsFile(new Date('2026-10-09T12:00:00Z'));
    expect(file).toMatchObject({ kind: 'redstring-settings', version: 1, exportedAt: '2026-10-09T12:00:00.000Z' });
    expect(file.settings).toEqual({ redstring_grid_mode: 'always', redstring_auto_save_mode: 'off' });
  });

  it('reads back only allowlisted string values', () => {
    const settings = readSettingsFile(JSON.stringify({
      kind: 'redstring-settings',
      version: 1,
      settings: {
        redstring_grid_mode: 'dot',
        redstring_node_scale: 2,
        github_access_token: 'planted',
        __proto__: { polluted: true }
      }
    }));
    expect(settings).toEqual({ redstring_grid_mode: 'dot' });
    expect({}.polluted).toBeUndefined();
  });

  it('refuses a file that is not a settings file, or is from a newer version', () => {
    expect(() => readSettingsFile('not json')).toThrow(/not a Redstring settings file/);
    expect(() => readSettingsFile('{"kind":"other","settings":{}}')).toThrow(/not a Redstring settings file/);
    expect(() => readSettingsFile('{"kind":"redstring-settings","version":2,"settings":{}}')).toThrow(/newer version/);
  });

  it('names only keys the app actually uses', () => {
    const source = allSource();
    const unknown = PREFERENCE_KEYS.filter((key) => !source.includes(key));
    expect(unknown).toEqual([]);
  });
});
