import { describe, it, expect } from 'vitest';
import {
  parseShipItStateForBundlePath,
  computeInstallOutcome,
  splitLogTailSinceOffset
} from '../../electron/updater-helpers.cjs';

describe('parseShipItStateForBundlePath', () => {
  it('returns null for empty / non-string input', () => {
    expect(parseShipItStateForBundlePath('')).toBe(null);
    expect(parseShipItStateForBundlePath(null)).toBe(null);
    expect(parseShipItStateForBundlePath(undefined)).toBe(null);
    expect(parseShipItStateForBundlePath(42)).toBe(null);
  });

  it('returns null for unparseable JSON', () => {
    expect(parseShipItStateForBundlePath('{not json')).toBe(null);
  });

  it('returns null when updateBundleURL is missing', () => {
    expect(parseShipItStateForBundlePath('{}')).toBe(null);
    expect(parseShipItStateForBundlePath('{"updateBundleURL": null}')).toBe(null);
  });

  it('strips file:// prefix from URL', () => {
    const input = JSON.stringify({
      updateBundleURL: 'file:///Users/u/Library/Caches/io.redstring.app.ShipIt/update.JHIGsMY/Redstring.app/'
    });
    expect(parseShipItStateForBundlePath(input)).toBe(
      '/Users/u/Library/Caches/io.redstring.app.ShipIt/update.JHIGsMY/Redstring.app/'
    );
  });

  it('URL-decodes the path', () => {
    const input = JSON.stringify({
      updateBundleURL: 'file:///Users/me/Library/Caches/has%20space/Redstring.app/'
    });
    expect(parseShipItStateForBundlePath(input)).toBe(
      '/Users/me/Library/Caches/has space/Redstring.app/'
    );
  });

  it('handles already-decoded paths gracefully', () => {
    const input = JSON.stringify({ updateBundleURL: '/already/decoded' });
    expect(parseShipItStateForBundlePath(input)).toBe('/already/decoded');
  });
});

describe('computeInstallOutcome', () => {
  it('returns noop when nothing was downloaded last session', () => {
    const out = computeInstallOutcome({
      currentVersion: '0.6.7',
      lastDownloadedVersion: null,
      failedInstallCount: {}
    });
    expect(out.action).toBe('noop');
    expect(out.nextState.clearLastDownloaded).toBe(false);
    expect(out.nextState.failedInstallCount).toEqual({});
  });

  it('clears state when current version matches lastDownloadedVersion', () => {
    const out = computeInstallOutcome({
      currentVersion: '0.6.8',
      lastDownloadedVersion: '0.6.8',
      failedInstallCount: { '0.6.8': 1 }
    });
    expect(out.action).toBe('clear');
    expect(out.nextState.clearLastDownloaded).toBe(true);
    expect(out.nextState.failedInstallCount).toEqual({});
  });

  it('increments fail count when current version != lastDownloadedVersion', () => {
    const out = computeInstallOutcome({
      currentVersion: '0.6.7',
      lastDownloadedVersion: '0.6.8',
      failedInstallCount: { '0.6.8': 1 }
    });
    expect(out.action).toBe('increment');
    expect(out.nextState.clearLastDownloaded).toBe(false);
    expect(out.nextState.failedInstallCount).toEqual({ '0.6.8': 2 });
  });

  it('initializes counter to 1 when missing', () => {
    const out = computeInstallOutcome({
      currentVersion: '0.6.7',
      lastDownloadedVersion: '0.6.8',
      failedInstallCount: {}
    });
    expect(out.nextState.failedInstallCount).toEqual({ '0.6.8': 1 });
  });

  it('preserves other version counters', () => {
    const out = computeInstallOutcome({
      currentVersion: '0.6.8',
      lastDownloadedVersion: '0.6.8',
      failedInstallCount: { '0.6.7': 5, '0.6.8': 2 }
    });
    expect(out.nextState.failedInstallCount).toEqual({ '0.6.7': 5 });
  });

  it('does not mutate the input failedInstallCount object', () => {
    const input = { '0.6.8': 1 };
    computeInstallOutcome({
      currentVersion: '0.6.7',
      lastDownloadedVersion: '0.6.8',
      failedInstallCount: input
    });
    expect(input).toEqual({ '0.6.8': 1 });
  });
});

describe('splitLogTailSinceOffset', () => {
  it('splits buffer into non-empty lines', () => {
    const buf = Buffer.from('line one\nline two\nline three\n', 'utf-8');
    const result = splitLogTailSinceOffset(buf, 100);
    expect(result.lines).toEqual(['line one', 'line two', 'line three']);
    expect(result.newOffset).toBe(100 + buf.length);
  });

  it('filters out empty lines (trailing newline doesn\'t produce empty entry)', () => {
    const buf = Buffer.from('only line\n\n\n', 'utf-8');
    const result = splitLogTailSinceOffset(buf, 0);
    expect(result.lines).toEqual(['only line']);
  });

  it('handles empty buffer', () => {
    const buf = Buffer.from('', 'utf-8');
    const result = splitLogTailSinceOffset(buf, 50);
    expect(result.lines).toEqual([]);
    expect(result.newOffset).toBe(50);
  });

  it('handles buffer without trailing newline', () => {
    const buf = Buffer.from('partial', 'utf-8');
    const result = splitLogTailSinceOffset(buf, 0);
    expect(result.lines).toEqual(['partial']);
    expect(result.newOffset).toBe(buf.length);
  });
});
