import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { parseBlocks, parseChangelog, parseNote } from '../../src/components/help/whatsNewMarkdown.js';
import {
  compareVersions,
  markWhatsNewSeen,
  shouldShowWhatsNewOnLaunch,
} from '../../src/components/help/whatsNewVersion.js';

describe('What\'s New markdown', () => {
  it('reads headings, lists, paragraphs and drops comments', () => {
    const blocks = parseBlocks([
      '<!-- for the author -->',
      '## Title',
      'One line',
      'and its second.',
      '',
      '- **First** item',
      '  carried on',
      '- Second',
    ].join('\n'));
    expect(blocks).toEqual([
      { type: 'heading', level: 2, text: 'Title' },
      { type: 'paragraph', text: 'One line and its second.' },
      { type: 'list', items: ['**First** item carried on', 'Second'] },
    ]);
  });

  it('splits a changelog into entries, Unreleased included', () => {
    const entries = parseChangelog([
      '# Changelog',
      'Preamble.',
      '## [Unreleased]',
      '### Added',
      '- Next',
      '## [0.15.9] - 2026-10-09',
      'Intro.',
      '### Fixed',
      '- A bug',
      '## [0.2.0] (start of beta) - 2026-01-22',
    ].join('\n'));
    expect(entries.map(e => [e.version, e.label, e.date, e.unreleased])).toEqual([
      [null, null, null, true],
      ['0.15.9', null, '2026-10-09', false],
      ['0.2.0', 'start of beta', '2026-01-22', false],
    ]);
    expect(entries[1].blocks[0]).toEqual({ type: 'paragraph', text: 'Intro.' });
  });

  it('reads every release in CHANGELOG.md', () => {
    const text = readFileSync('CHANGELOG.md', 'utf-8');
    const headings = text.split('\n').filter(l => l.startsWith('## ')).length;
    const entries = parseChangelog(text);
    expect(entries.length).toBe(headings);
    for (const e of entries) {
      expect(e.unreleased || /^\d+\.\d+\.\d+/.test(e.version)).toBe(true);
      expect(e.unreleased || /^\d{4}-\d{2}-\d{2}$/.test(e.date)).toBe(true);
    }
  });

  it('reads the note, its title and its version gate', () => {
    expect(parseNote('<!-- just a comment -->\n')).toBeNull();
    expect(parseNote('<!-- from 1.0.0 -->\n## Hello\nBody.')).toEqual({
      from: '1.0.0',
      title: 'Hello',
      blocks: [{ type: 'paragraph', text: 'Body.' }],
    });
  });
});

describe('What\'s New versions', () => {
  it('orders versions and prereleases', () => {
    const sorted = ['1.0.0', '0.1.0-alpha', '1.0.0-rc.1', '0.15.9', '1.0.0-rc.10', '0.0.1', '1.0.0-beta'];
    sorted.sort(compareVersions);
    expect(sorted).toEqual(['0.0.1', '0.1.0-alpha', '0.15.9', '1.0.0-beta', '1.0.0-rc.1', '1.0.0-rc.10', '1.0.0']);
  });

  describe('on launch', () => {
    beforeEach(() => localStorage.clear());

    it('stays closed on a first install', () => {
      expect(shouldShowWhatsNewOnLaunch('0.15.9')).toBe(false);
    });

    it('opens for a device onboarded before What\'s New existed', () => {
      localStorage.setItem('redstring-welcome-seen', 'true');
      expect(shouldShowWhatsNewOnLaunch('0.15.9')).toBe(true);
    });

    it('opens only for a newer version', () => {
      markWhatsNewSeen('0.15.9');
      expect(shouldShowWhatsNewOnLaunch('0.15.9')).toBe(false);
      expect(shouldShowWhatsNewOnLaunch('0.15.8')).toBe(false);
      expect(shouldShowWhatsNewOnLaunch('1.0.0-rc.1')).toBe(true);
    });
  });
});
