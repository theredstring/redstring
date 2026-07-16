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
