import { describe, it, expect } from 'vitest';
import {
  SURFACES,
  INTENTS,
  intentsForSurface,
  defaultIntentForSurface,
  shouldSkipPicker,
  policyForIntent,
  intentLabel,
  getIntent
} from './intents.js';
import { TOOL_POLICIES } from '../toolPolicy.js';

const thingFacts = { webInstanceCount: 5, hasLadder: false };
const webFacts = { isBlank: false };

describe('intent registry', () => {
  it('gives every surface a default, and it is the ask that button already did', () => {
    expect(defaultIntentForSurface(SURFACES.THING, thingFacts).action).toBe('define-node');
    expect(defaultIntentForSurface(SURFACES.CONNECTION, { edgeCount: 1 }).action).toBe('refine-connections');
    expect(defaultIntentForSurface(SURFACES.WEB, webFacts).action).toBe('grow-graph');
    expect(defaultIntentForSurface(SURFACES.LADDER, {}).action).toBe('refine-abstraction');
  });

  it('gives every intent a unique id and a real surface', () => {
    const ids = INTENTS.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    const surfaces = new Set(Object.values(SURFACES));
    for (const i of INTENTS) expect(surfaces.has(i.surface)).toBe(true);
  });

  it('gives each intent its own dedupe bucket per surface', () => {
    // Two intents on one surface sharing an `action` means the second ships a
    // truncated instruction block written for the first.
    for (const surface of Object.values(SURFACES)) {
      const actions = INTENTS.filter(i => i.surface === surface).map(i => i.action);
      expect(new Set(actions).size, `${surface} has a duplicate action`).toBe(actions.length);
    }
  });
});

describe('availability gating', () => {
  it('hides "does this connect to anything here?" when there is nothing to check against', () => {
    const alone = intentsForSurface(SURFACES.THING, { webInstanceCount: 1 }).map(i => i.id);
    expect(alone).not.toContain('connect-into-web');
    const populated = intentsForSurface(SURFACES.THING, { webInstanceCount: 2 }).map(i => i.id);
    expect(populated).toContain('connect-into-web');
  });

  it('hides the gap check when several Connections are selected', () => {
    expect(intentsForSurface(SURFACES.CONNECTION, { edgeCount: 3 }).map(i => i.id))
      .not.toContain('connection-gaps');
  });

  it('hides summarize and audit on a blank Web', () => {
    const blank = intentsForSurface(SURFACES.WEB, { isBlank: true }).map(i => i.id);
    expect(blank).not.toContain('summarize-web');
    expect(blank).not.toContain('audit-web');
  });
});

describe('conditional labels', () => {
  it('reads Build on an empty ladder and Expand on a populated one', () => {
    const ladder = getIntent('ladder-build');
    expect(intentLabel(ladder, { hasLadder: false })).toMatch(/^Build/);
    expect(intentLabel(ladder, { hasLadder: true })).toMatch(/^Expand/);
  });

  it('reads Populate on a blank Web and Grow on one with content', () => {
    const grow = getIntent('grow-web');
    expect(intentLabel(grow, { isBlank: true })).toBe('Populate this Web');
    expect(intentLabel(grow, { isBlank: false })).toBe('Grow this Web');
  });
});

describe('shouldSkipPicker', () => {
  it('skips the picker on the abstraction ladder, which has one ask', () => {
    expect(shouldSkipPicker(SURFACES.LADDER, {})).toBe(true);
  });

  it('shows the picker everywhere else', () => {
    expect(shouldSkipPicker(SURFACES.THING, thingFacts)).toBe(false);
    expect(shouldSkipPicker(SURFACES.CONNECTION, { edgeCount: 1 })).toBe(false);
    expect(shouldSkipPicker(SURFACES.WEB, webFacts)).toBe(false);
  });

  it('does not let a lone free-text row hold the picker open', () => {
    // A blank Web with several Connections selected is not a real combination;
    // this pins the rule rather than the scenario — free-text is a row, not an ask.
    const webIntents = intentsForSurface(SURFACES.WEB, { isBlank: true });
    expect(webIntents.map(i => i.id)).toEqual(['grow-web', 'web-freetext']);
    expect(shouldSkipPicker(SURFACES.WEB, { isBlank: true })).toBe(true);
  });
});

describe('policyForIntent', () => {
  it('leaves imperative and free-text asks unrestricted', () => {
    expect(policyForIntent(getIntent('define-components'))).toBeUndefined();
    expect(policyForIntent(getIntent('thing-freetext'))).toBeUndefined();
  });

  it('locks read-only asks down', () => {
    expect(policyForIntent(getIntent('explain-thing'))).toBe(TOOL_POLICIES.READ_ONLY);
    expect(policyForIntent(getIntent('audit-web'))).toBe(TOOL_POLICIES.READ_ONLY);
  });

  it('runs query-first asks read-only so their "no" means something', () => {
    expect(policyForIntent(getIntent('connect-into-web'))).toBe(TOOL_POLICIES.QUERY_FIRST);
    expect(policyForIntent(getIntent('connection-gaps'))).toBe(TOOL_POLICIES.QUERY_FIRST);
  });
});
