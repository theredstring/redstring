// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  extractWorkingMemory,
  compactionDue,
  noteOverBudget,
  clipNote,
  fallbackWorkingMemory
} from '../../src/druid/workingMemory.js';

describe('extractWorkingMemory', () => {
  it('returns the whole reply as the thought when there is no note', () => {
    expect(extractWorkingMemory('  rivers carve valleys  ')).toEqual({ memory: null, thought: 'rivers carve valleys', truncated: false });
  });

  it('separates the note from the thought around it', () => {
    const r = extractWorkingMemory('I should keep this.\n<working_memory>\nRivers web: erosion next.\n</working_memory>\nOnward.');
    expect(r.memory).toBe('Rivers web: erosion next.');
    expect(r.thought).toBe('I should keep this.\n\nOnward.');
    expect(r.truncated).toBe(false);
  });

  it('takes the last note when the model corrects itself', () => {
    const r = extractWorkingMemory('<working_memory>draft</working_memory> no — <working_memory>final</working_memory>');
    expect(r.memory).toBe('final');
  });

  it('keeps an unclosed note and flags it', () => {
    const r = extractWorkingMemory('ok <working_memory>\nhalf a note that ran out of tok');
    expect(r.memory).toBe('half a note that ran out of tok');
    expect(r.truncated).toBe(true);
    expect(r.thought).toBe('ok');
  });

  it('treats an empty note as no note', () => {
    expect(extractWorkingMemory('<working_memory>  </working_memory>').memory).toBeNull();
  });
});

describe('compactionDue', () => {
  it('fires on context fill', () => {
    expect(compactionDue({ promptTokens: 5800, contextWindow: 8192, compactAt: 0.7, historyLength: 2 })).toBe('context');
    expect(compactionDue({ promptTokens: 5000, contextWindow: 8192, compactAt: 0.7, historyLength: 2 })).toBeNull();
  });

  it('fires before AgentLoop would start dropping history on its own', () => {
    expect(compactionDue({ promptTokens: 100, contextWindow: 8192, historyLength: 16, historyCap: 16 })).toBe('history');
  });
});

describe('note budget', () => {
  it('flags and clips a note over a quarter of the window', () => {
    const long = 'x'.repeat(4 * 8192);
    expect(noteOverBudget(long, 8192)).toBe(true);
    expect(noteOverBudget('short', 8192)).toBe(false);
    const clipped = clipNote(long, 8192);
    expect(clipped.length).toBeLessThan(long.length);
    expect(clipped).toMatch(/clipped/);
  });
});

describe('fallbackWorkingMemory', () => {
  it('keeps the previous note whole and says the rest was not consolidated', () => {
    const history = [
      { role: 'user', content: '[cycle 1]' },
      { role: 'assistant', content: 'Deltas form where rivers slow.' }
    ];
    const note = fallbackWorkingMemory('Studying rivers.', history, 'Next: estuaries.');
    expect(note.startsWith('Studying rivers.')).toBe(true);
    expect(note).toMatch(/without consolidation/);
    expect(note).toMatch(/Deltas form/);
    expect(note).toMatch(/estuaries/);
  });

  it('is empty-safe', () => {
    expect(fallbackWorkingMemory('', [], '')).toBe('');
  });
});
