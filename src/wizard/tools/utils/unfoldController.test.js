/**
 * Tests for the A3 unfold PLANNER (tool-layer half). The store-side executor
 * lives in toolResultApplier.js; here we only verify the plan-building logic:
 * yes / no / null / depth-limit paths, with every one-off call mocked.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../services/oneShot.js', () => ({
  oneShotChoice: vi.fn(),
  oneShotBoolean: vi.fn(),
  oneShotLabel: vi.fn(),
  oneShotList: vi.fn()
}));

import { oneShotChoice, oneShotBoolean, oneShotLabel, oneShotList } from '../../../services/oneShot.js';
import { planUnfold, MAX_UNFOLD_DEPTH } from './unfoldController.js';
import { GRAPH_SHAPE_KEYS } from './graphShapes.js';

const seqIndex = GRAPH_SHAPE_KEYS.indexOf('sequence');
const nodeSpecs = [{ name: 'OK Computer' }, { name: 'Kid A' }];

beforeEach(() => vi.clearAllMocks());

describe('planUnfold — yes path', () => {
  it('unfolds each member into an ordered inside for a sequence shape', async () => {
    oneShotLabel.mockResolvedValue({ value: 'album', callId: 'k' });        // member kind
    oneShotBoolean.mockResolvedValue({ value: true, callId: 'u' });          // should unfold: yes
    oneShotChoice.mockResolvedValue({ index: seqIndex, none: false, callId: 's' }); // inside shape: sequence
    oneShotList.mockResolvedValue({ items: ['Airbag', 'Paranoid Android'], callId: 'l' });

    const plan = await planUnfold({ nodeSpecs, request: 'radiohead albums and their songs', buildId: 'b' });
    expect(plan).toBeTruthy();
    expect(plan.memberKind).toBe('album');
    expect(plan.members).toHaveLength(2);
    const first = plan.members[0];
    expect(first.memberName).toBe('OK Computer');
    expect(first.nodes.map(n => n.name)).toEqual(['Airbag', 'Paranoid Android']);
    // sequence → one directed edge in order
    expect(first.edges).toHaveLength(1);
    expect(first.edges[0]).toMatchObject({ source: 'Airbag', target: 'Paranoid Android', directionality: 'unidirectional' });
    expect(first.insideShape).toBe('sequence');
  });

  it('leaves the inside edgeless for a non-ordered shape', async () => {
    oneShotLabel.mockResolvedValue({ value: 'country', callId: 'k' });
    oneShotBoolean.mockResolvedValue({ value: true, callId: 'u' });
    oneShotChoice.mockResolvedValue({ index: GRAPH_SHAPE_KEYS.indexOf('set'), none: false, callId: 's' });
    oneShotList.mockResolvedValue({ items: ['A', 'B', 'C'], callId: 'l' });

    const plan = await planUnfold({ nodeSpecs: [{ name: 'Europe' }], request: 'continents', buildId: 'b' });
    expect(plan.members[0].edges).toEqual([]);
  });
});

describe('planUnfold — no / null paths', () => {
  it('returns null when the model says do not unfold', async () => {
    oneShotLabel.mockResolvedValue({ value: 'album', callId: 'k' });
    oneShotBoolean.mockResolvedValue({ value: false, callId: 'u' });
    expect(await planUnfold({ nodeSpecs, buildId: 'b' })).toBeNull();
    expect(oneShotList).not.toHaveBeenCalled();
  });

  it('returns null when the unfold decision has no answer (no model)', async () => {
    oneShotLabel.mockResolvedValue({ value: 'album', callId: 'k' });
    oneShotBoolean.mockResolvedValue(null);
    expect(await planUnfold({ nodeSpecs, buildId: 'b' })).toBeNull();
  });

  it('returns null when the member kind cannot be determined', async () => {
    oneShotLabel.mockResolvedValue(null);
    expect(await planUnfold({ nodeSpecs, buildId: 'b' })).toBeNull();
    expect(oneShotBoolean).not.toHaveBeenCalled();
  });

  it('returns null when no member produces any inside content', async () => {
    oneShotLabel.mockResolvedValue({ value: 'album', callId: 'k' });
    oneShotBoolean.mockResolvedValue({ value: true, callId: 'u' });
    oneShotChoice.mockResolvedValue(null);
    oneShotList.mockResolvedValue(null); // no content for any member
    expect(await planUnfold({ nodeSpecs, buildId: 'b' })).toBeNull();
  });
});

describe('planUnfold — guards', () => {
  it('makes zero calls at the depth limit (no recursion into contents)', async () => {
    const plan = await planUnfold({ nodeSpecs, buildId: 'b', depth: MAX_UNFOLD_DEPTH });
    expect(plan).toBeNull();
    expect(oneShotLabel).not.toHaveBeenCalled();
    expect(oneShotBoolean).not.toHaveBeenCalled();
  });

  it('does not unfold ladders (abstraction axis)', async () => {
    const plan = await planUnfold({ nodeSpecs, shape: 'ladder', buildId: 'b' });
    expect(plan).toBeNull();
    expect(oneShotBoolean).not.toHaveBeenCalled();
  });

  it('skips member-kind derivation when memberKind is provided explicitly', async () => {
    oneShotBoolean.mockResolvedValue({ value: true, callId: 'u' });
    oneShotChoice.mockResolvedValue({ index: seqIndex, none: false, callId: 's' });
    oneShotList.mockResolvedValue({ items: ['x'], callId: 'l' });
    const plan = await planUnfold({ nodeSpecs: [{ name: 'M' }], memberKind: 'album', buildId: 'b' });
    expect(oneShotLabel).not.toHaveBeenCalled();
    expect(plan.memberKind).toBe('album');
  });
});
