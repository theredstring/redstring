import { describe, it, expect } from 'vitest';
import {
  READ_ONLY_TOOLS,
  QUERY_FIRST_TOOLS,
  TOOL_POLICIES,
  resolveToolPolicy,
  buildPolicyToolList,
  isToolAllowed,
  toolRefusalResult
} from './toolPolicy.js';
import { getToolDefinitions } from './tools/schemas.js';

const allTools = getToolDefinitions();
const allNames = new Set(allTools.map(t => t.name));

describe('tool policy allow-sets', () => {
  // The sets are maintained by hand (see the header comment in toolPolicy.js for
  // why they cannot be derived). A rename would otherwise silently shrink them,
  // and a policy that allows nothing looks exactly like a model refusing to work.
  it('every allowed tool is a real registered tool', () => {
    for (const name of READ_ONLY_TOOLS) {
      expect(allNames.has(name), `${name} is not a registered tool`).toBe(true);
    }
    for (const name of QUERY_FIRST_TOOLS) {
      expect(allNames.has(name), `${name} is not a registered tool`).toBe(true);
    }
  });

  it('withholds the tools that would defeat the policy', () => {
    // listTools sets _unlockAllTools and re-expands the toolset; switchToGraph
    // navigates; planTask/declareGoal write conversation state.
    for (const name of ['listTools', 'switchToGraph', 'planTask', 'declareGoal']) {
      expect(READ_ONLY_TOOLS.has(name), `${name} must not be read-only`).toBe(false);
      expect(QUERY_FIRST_TOOLS.has(name), `${name} must not be query-first`).toBe(false);
    }
  });

  it('withholds every graph-mutating tool', () => {
    const mutating = [
      'createNode', 'updateNode', 'deleteNode', 'createEdge', 'updateEdge', 'deleteEdge',
      'replaceEdges', 'createGraph', 'createPopulatedGraph', 'expandGraph', 'buildComposition',
      'populateDefinitionGraph', 'createGroup', 'updateGroup', 'deleteGroup', 'condenseToNode',
      'decomposeNode', 'setNodeType', 'setNodeSize', 'themeGraph', 'enrichFromWikipedia',
      'linkIdentifier', 'mergeNodes', 'mergeGraphs', 'importTabularAsGraph',
      'materializeSemanticEntities', 'importKnowledgeCluster', 'thingGroup'
    ];
    for (const name of mutating) {
      expect(QUERY_FIRST_TOOLS.has(name), `${name} must not be allowed`).toBe(false);
    }
  });

  it('query-first adds selectNode and nothing else', () => {
    const extra = [...QUERY_FIRST_TOOLS].filter(n => !READ_ONLY_TOOLS.has(n));
    expect(extra).toEqual(['selectNode']);
  });
});

describe('resolveToolPolicy', () => {
  it('returns null for absent or unknown policies', () => {
    expect(resolveToolPolicy(undefined)).toBeNull();
    expect(resolveToolPolicy(null)).toBeNull();
    expect(resolveToolPolicy('nonsense')).toBeNull();
  });

  it('resolves the known policies', () => {
    expect(resolveToolPolicy(TOOL_POLICIES.READ_ONLY).allow).toBe(READ_ONLY_TOOLS);
    expect(resolveToolPolicy(TOOL_POLICIES.QUERY_FIRST).allow).toBe(QUERY_FIRST_TOOLS);
  });
});

describe('buildPolicyToolList', () => {
  it('passes the list through untouched with no policy', () => {
    expect(buildPolicyToolList(allTools, null)).toBe(allTools);
  });

  it('offers only allowed tools', () => {
    const list = buildPolicyToolList(allTools, resolveToolPolicy(TOOL_POLICIES.READ_ONLY));
    expect(list.length).toBeGreaterThan(0);
    for (const tool of list) {
      expect(READ_ONLY_TOOLS.has(tool.name)).toBe(true);
    }
  });

  it('includes the reads that TOOL_TIERS would have gated away', () => {
    // The whole reason this builds instead of filtering selectToolsForTurn:
    // getNodeContext and inspectPrototype are 'hasNodes'-gated there, and a
    // query about a Thing in a sparse Web is exactly when they are needed.
    const names = buildPolicyToolList(allTools, resolveToolPolicy(TOOL_POLICIES.QUERY_FIRST))
      .map(t => t.name);
    expect(names).toContain('getNodeContext');
    expect(names).toContain('inspectPrototype');
    expect(names).toContain('search');
  });

  it('narrows conditionally-mutating tools to their read branch', () => {
    const list = buildPolicyToolList(allTools, resolveToolPolicy(TOOL_POLICIES.READ_ONLY));
    expect(list.find(t => t.name === 'abstractionChain').parameters.properties.action.enum)
      .toEqual(['read']);
    expect(list.find(t => t.name === 'manageDefinitions').parameters.properties.action.enum)
      .toEqual(['list']);
  });

  it('does not mutate the shared schema objects', () => {
    // getToolDefinitions() returns a fresh array of SHARED object literals, so a
    // narrowing that wrote in place would leak into every other caller.
    buildPolicyToolList(allTools, resolveToolPolicy(TOOL_POLICIES.READ_ONLY));
    const fresh = getToolDefinitions();
    expect(fresh.find(t => t.name === 'abstractionChain').parameters.properties.action.enum)
      .toEqual(['read', 'build', 'add', 'remove']);
    expect(fresh.find(t => t.name === 'manageDefinitions').parameters.properties.action.enum)
      .toEqual(['list', 'remove']);
  });
});

describe('isToolAllowed / toolRefusalResult', () => {
  it('allows everything when unrestricted', () => {
    expect(isToolAllowed('deleteNode', null)).toBe(true);
  });

  it('refuses tools outside the allow-set', () => {
    const policy = resolveToolPolicy(TOOL_POLICIES.READ_ONLY);
    expect(isToolAllowed('readGraph', policy)).toBe(true);
    expect(isToolAllowed('deleteNode', policy)).toBe(false);
  });

  it('shapes the refusal like the other loop locks', () => {
    const result = toolRefusalResult('deleteNode', resolveToolPolicy(TOOL_POLICIES.READ_ONLY));
    expect(result.locked).toBe(true);
    expect(result.message).toContain('deleteNode');
  });

  it('tells a query-first ask it may propose instead', () => {
    const result = toolRefusalResult('createEdge', resolveToolPolicy(TOOL_POLICIES.QUERY_FIRST));
    expect(result.message).toContain('askMultipleChoice');
  });
});
