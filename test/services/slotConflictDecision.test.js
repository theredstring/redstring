import { describe, it, expect } from 'vitest';
import { decideSlotConflict } from '../../src/services/slotConflictDecision.js';

const info = (userNodeCount) => ({ userNodeCount, graphCount: userNodeCount ? 3 : 0 });

describe('decideSlotConflict', () => {
  it('both slots empty: nothing to lose, no prompt', () => {
    for (const sourceOfTruth of ['git', 'local', undefined]) {
      const d = decideSlotConflict({ localInfo: info(0), gitInfo: info(0), sourceOfTruth });
      expect(d.conflict).toBe(false);
      expect(d.reason).toBe('both-empty');
    }
  });

  it('THE 2026-09-12 CASE: an empty git primary beside a populated local file is a conflict', () => {
    const d = decideSlotConflict({
      localInfo: info(1822), gitInfo: info(0), sourceOfTruth: 'git'
    });
    expect(d.conflict).toBe(true);
    expect(d.reason).toBe('primary-empty');
    expect(d.riskOverwriteEmptyPrimary).toBe(true);
  });

  it('an empty local primary beside a populated repo is a conflict too', () => {
    const d = decideSlotConflict({
      localInfo: info(0), gitInfo: info(1822), sourceOfTruth: 'local'
    });
    expect(d.conflict).toBe(true);
    expect(d.riskOverwriteEmptyPrimary).toBe(true);
  });

  it('a populated primary beside an empty secondary just wins, no prompt', () => {
    expect(decideSlotConflict({ localInfo: info(0), gitInfo: info(50), sourceOfTruth: 'git' }))
      .toMatchObject({ conflict: false, reason: 'secondary-empty' });
    expect(decideSlotConflict({ localInfo: info(50), gitInfo: info(0), sourceOfTruth: 'local' }))
      .toMatchObject({ conflict: false, reason: 'secondary-empty' });
  });

  it('one side empty with NO primary chosen asks the user to choose', () => {
    const d = decideSlotConflict({ localInfo: info(0), gitInfo: info(50), sourceOfTruth: undefined });
    expect(d.conflict).toBe(true);
    expect(d.requiresPrimarySelection).toBe(true);
    // Nothing is "risking the primary" when no primary exists yet.
    expect(d.riskOverwriteEmptyPrimary).toBe(false);
  });

  it('two populated slots defer to the semantic comparison', () => {
    const d = decideSlotConflict({ localInfo: info(10), gitInfo: info(10), sourceOfTruth: 'git' });
    expect(d.needsComparison).toBe(true);
    expect(d.conflict).toBe(false);
  });

  it('equal contents are not a conflict unless a prompt was forced', () => {
    expect(decideSlotConflict({
      localInfo: info(10), gitInfo: info(10), sourceOfTruth: 'git', isDifferent: false
    })).toMatchObject({ conflict: false, reason: 'equal', areIdentical: true });

    const forced = decideSlotConflict({
      localInfo: info(10), gitInfo: info(10), sourceOfTruth: undefined, forcePrompt: true, isDifferent: false
    });
    expect(forced.conflict).toBe(true);
    expect(forced.areIdentical).toBe(true);
    expect(forced.requiresPrimarySelection).toBe(true);
  });

  it('diverged contents are a conflict', () => {
    const d = decideSlotConflict({
      localInfo: info(10), gitInfo: info(40), sourceOfTruth: 'git', isDifferent: true
    });
    expect(d.conflict).toBe(true);
    expect(d.reason).toBe('diverged');
    expect(d.areIdentical).toBe(false);
    expect(d.riskOverwriteEmptyPrimary).toBe(false);
  });

  it('full one-side-empty matrix: a conflict exactly when the PRIMARY is the empty one', () => {
    // The old `if (local === 0 || git === 0) return null` collapsed every row
    // here into "no conflict", including the three that lose data.
    for (const [local, git, sourceOfTruth, expectConflict] of [
      [0, 5, 'git', false],      // primary (git) holds the data — it wins
      [0, 5, 'local', true],     // primary (local) is empty, repo has 5
      [0, 5, undefined, true],   // no primary chosen — ask
      [5, 0, 'git', true],       // primary (git) is empty, file has 5 ← the incident
      [5, 0, 'local', false],    // primary (local) holds the data — it wins
      [5, 0, undefined, true]    // no primary chosen — ask
    ]) {
      const d = decideSlotConflict({ localInfo: info(local), gitInfo: info(git), sourceOfTruth });
      expect(d.conflict, `local=${local} git=${git} sot=${sourceOfTruth}`).toBe(expectConflict);
    }
  });
});
