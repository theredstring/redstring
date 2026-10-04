// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readWebs, DEFAULT_PROMPT_SPACE } from '../../src/druid/promptSpace.js';
import { loadPromptSpace } from '../../src/druid/promptSpaceFile.js';

const shipped = path.join(process.cwd(), 'src', 'druid', 'prompt-space.redstring');

describe('prompt space', () => {
  it('reads the shipped .redstring: identity, questions, and every move as a Thing', () => {
    const s = loadPromptSpace(shipped);
    expect(s.source).toBe(shipped);
    expect(s.system).toBe(DEFAULT_PROMPT_SPACE.system);
    expect(s.questions).toEqual(DEFAULT_PROMPT_SPACE.questions);
    expect(Object.keys(s.moves)).toEqual(expect.arrayContaining(['make', 'specialize', 'weighBelief', 'wonder']));
  });

  it('an edit made in the file wins over the defaults', () => {
    const json = JSON.parse(fs.readFileSync(shipped, 'utf8'));
    const protos = json.prototypeSpace.prototypes;
    const key = Object.keys(protos).find(k => protos[k].name === 'Thought');
    protos[key].description = 'What is on your mind, plainly?';
    const tmp = path.join(os.tmpdir(), `prompt-space-${process.pid}.redstring`);
    fs.writeFileSync(tmp, JSON.stringify(json));
    expect(loadPromptSpace(tmp).questions.thought).toBe('What is on your mind, plainly?');
    fs.unlinkSync(tmp);
  });

  it('falls back to the defaults when the file is missing or unreadable', () => {
    expect(loadPromptSpace('/nowhere/at/all.redstring').source).toBe('defaults');
    expect(readWebs({})).toEqual({});
  });
});
