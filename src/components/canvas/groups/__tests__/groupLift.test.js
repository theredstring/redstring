import { describe, it, expect } from 'vitest';
import { collectLiftedGroup } from '../groupLift.js';
import { buildGroupsByMemberIdIndex, buildChildGroupIdsIndex } from '../../../../services/groupLayout.js';

const structureOf = (groups) => {
  const groupsById = new Map(groups.map(g => [g.id, g]));
  return { groupsById, childGroupIds: buildChildGroupIdsIndex(groupsById, buildGroupsByMemberIdIndex(groupsById)) };
};

describe('collectLiftedGroup', () => {
  it('holds a Thing-group, its anchor, its members, and every group nested in it with theirs', () => {
    const structure = structureOf([
      { id: 'outer', linkedNodePrototypeId: 'p1', anchorInstanceId: 'a1', memberInstanceIds: ['m1', 'a2', 'm2'] },
      { id: 'inner', linkedNodePrototypeId: 'p2', anchorInstanceId: 'a2', memberInstanceIds: ['m3'] },
      { id: 'beside', linkedNodePrototypeId: 'p3', anchorInstanceId: 'a3', memberInstanceIds: ['m4'] },
    ]);
    const lift = collectLiftedGroup('outer', structure);
    expect([...lift.groupIds].sort()).toEqual(['inner', 'outer']);
    expect([...lift.instanceIds].sort()).toEqual(['a1', 'a2', 'm1', 'm2', 'm3']);
  });

  it('lifts nothing for a plain group or no group', () => {
    const structure = structureOf([{ id: 'plain', memberInstanceIds: ['m1'] }]);
    expect(collectLiftedGroup('plain', structure)).toBeNull();
    expect(collectLiftedGroup(null, structure)).toBeNull();
  });
});
