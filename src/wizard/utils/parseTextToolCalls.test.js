/**
 * Tests for parseTextToolCalls — the text-register tool-call salvage parser.
 */

import { describe, it, expect } from 'vitest';
import { parseTextToolCalls } from './parseTextToolCalls.js';

const AVAILABLE = new Set(['createGraph', 'planTask', 'expandGraph', 'populateDefinitionGraph']);

describe('parseTextToolCalls', () => {
  it('parses the real transcript into 2 calls (primary fixture)', () => {
    const transcript = `createGraph({"name": "GTA San Andreas Locations", "color": "sunset"})

planTask({
  "steps": [
    {"description": "Identify major locations...", "status": "pending", "substeps": [{"description": "Sketch initial location structure...", "status": "pending"}]}
  ]
})`;

    const { calls, remainingText } = parseTextToolCalls(transcript, AVAILABLE);

    expect(calls).toHaveLength(2);
    expect(calls[0].name).toBe('createGraph');
    expect(calls[0].arguments).toEqual({ name: 'GTA San Andreas Locations', color: 'sunset' });
    expect(calls[1].name).toBe('planTask');
    expect(calls[1].arguments.steps).toHaveLength(1);
    expect(calls[1].arguments.steps[0].substeps[0].description).toContain('Sketch initial');
    // Everything matched → no leftover prose
    expect(remainingText).toBe('');
  });

  it('returns no calls for plain prose', () => {
    const { calls, remainingText } = parseTextToolCalls(
      'Sure! I can help you map out the locations. Which region do you want to start with?',
      AVAILABLE
    );
    expect(calls).toHaveLength(0);
    expect(remainingText).toContain('Which region');
  });

  it('ignores unknown tool names (not offered this turn)', () => {
    const { calls } = parseTextToolCalls('deleteEverything({"confirm": true})', AVAILABLE);
    expect(calls).toHaveLength(0);
  });

  it('ignores a call whose name resembles a tool but is not whitelisted', () => {
    // "someOtherFn" mentions nothing real; even if prose names a real tool without
    // the call syntax it must not trigger.
    const { calls } = parseTextToolCalls('You could use createGraph to start.', AVAILABLE);
    expect(calls).toHaveLength(0);
  });

  it('discards malformed JSON that cannot be repaired', () => {
    const { calls } = parseTextToolCalls('createGraph({"name": "Broken, ::: })', AVAILABLE);
    expect(calls).toHaveLength(0);
  });

  it('repairs single-quoted arguments', () => {
    const { calls } = parseTextToolCalls("createGraph({'name': 'Test Graph', 'color': 'blue'})", AVAILABLE);
    expect(calls).toHaveLength(1);
    expect(calls[0].arguments).toEqual({ name: 'Test Graph', color: 'blue' });
  });

  it('repairs trailing commas', () => {
    const { calls } = parseTextToolCalls('expandGraph({"nodes": "[]", "edges": "[]",})', AVAILABLE);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('expandGraph');
  });

  it('extracts a call embedded mid-sentence and strips it from the prose', () => {
    const text = 'Okay, first I will createGraph({"name": "Cities"}) and then add nodes.';
    const { calls, remainingText } = parseTextToolCalls(text, AVAILABLE);
    expect(calls).toHaveLength(1);
    expect(calls[0].arguments).toEqual({ name: 'Cities' });
    expect(remainingText).not.toContain('createGraph(');
    expect(remainingText).toContain('Okay, first I will');
    expect(remainingText).toContain('and then add nodes');
  });

  it('handles braces inside string values without miscounting nesting', () => {
    const { calls } = parseTextToolCalls('createGraph({"name": "A {weird} name", "color": "red"})', AVAILABLE);
    expect(calls).toHaveLength(1);
    expect(calls[0].arguments.name).toBe('A {weird} name');
  });

  it('handles empty / non-string input', () => {
    expect(parseTextToolCalls('', AVAILABLE)).toEqual({ calls: [], remainingText: '' });
    expect(parseTextToolCalls(null, AVAILABLE)).toEqual({ calls: [], remainingText: '' });
  });
});

describe('parseTextToolCalls — bare JSON objects', () => {
  const SMALL_TIER = ['expandGraph', 'buildComposition', 'populateDefinitionGraph', 'sketchGraph', 'readGraph'];

  // Verbatim shape of what qwen3-4b wrote instead of calling buildComposition.
  const LAYERS_REPLY = '{ "layers": [ { "name": "Mesoamerican Deities", "color": "orange", "display": "decomposed", '
    + '"definition": { "nodes": [ { "name": "Quetzalcoatl" }, { "name": "Tlaloc" } ], '
    + '"edges": [ { "source": "Quetzalcoatl", "target": "Tlaloc", "type": "Shared Domain" } ] } } ] }\n'
    + 'The Mesoamerican Deities web is now complete with nested structure and meaningful connections.';

  it('recovers a bare buildComposition args object and keeps the prose', () => {
    const { calls, remainingText } = parseTextToolCalls(LAYERS_REPLY, SMALL_TIER);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('buildComposition');
    expect(calls[0].arguments.layers[0].definition.nodes).toHaveLength(2);
    expect(remainingText).toBe('The Mesoamerican Deities web is now complete with nested structure and meaningful connections.');
  });

  it('tells populateDefinitionGraph from expandGraph by nodeName', () => {
    const def = parseTextToolCalls('{"nodeName": "Earth", "nodes": [{"name": "Core"}], "edges": []}', SMALL_TIER);
    expect(def.calls[0].name).toBe('populateDefinitionGraph');
    const flat = parseTextToolCalls('{"nodes": [{"name": "Mars"}], "groups": []}', SMALL_TIER);
    expect(flat.calls[0].name).toBe('expandGraph');
  });

  it('recovers the native {name, arguments} form inside <tool_call> tags', () => {
    const { calls, remainingText } = parseTextToolCalls(
      '<tool_call>\n{"name": "readGraph", "arguments": {}}\n</tool_call>', SMALL_TIER);
    expect(calls).toEqual([{ name: 'readGraph', arguments: {} }]);
    expect(remainingText).toBe('');
  });

  it('strips a ```json fence around a salvaged object', () => {
    const { calls, remainingText } = parseTextToolCalls('Here:\n```json\n{"nodes": [{"name": "Mars"}]}\n```', SMALL_TIER);
    expect(calls[0].name).toBe('expandGraph');
    expect(remainingText).toBe('Here:');
  });

  it('only infers tools offered this turn', () => {
    expect(parseTextToolCalls(LAYERS_REPLY, ['expandGraph']).calls).toEqual([]);
    expect(parseTextToolCalls('{"name": "deleteNode", "arguments": {"name": "X"}}', SMALL_TIER).calls).toEqual([]);
  });

  it('ignores objects that match no tool shape', () => {
    expect(parseTextToolCalls('The answer is {"count": 3}.', SMALL_TIER).calls).toEqual([]);
  });

  it('prefers the call form when both appear', () => {
    const { calls } = parseTextToolCalls('readGraph({}) and {"nodes": [{"name": "A"}]}', SMALL_TIER);
    expect(calls.map(c => c.name)).toEqual(['readGraph']);
  });
});
