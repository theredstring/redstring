/**
 * Canaries: a few of the Druid's calls, in the exact shape it asks them, with
 * answers written by hand. They need no teacher, and they catch a model
 * learning to game the rewards: abstaining, naming positions, saying yes to
 * everything, naming what is already there (scripts/druid-canary.mjs).
 *
 * Each is a call the Druid really made, or one like it, and most are ones a
 * model got wrong: Qwen3-4B gave the parts of Venus as "No parts. Empty. Only
 * the web's silence", and said someone explaining Venus would talk about a
 * "Sense of being inside" (2026-10-06).
 */

import { DEFAULT_PROMPT_SPACE } from '../promptSpace.js';

const SYSTEM = DEFAULT_PROMPT_SPACE.system;
const HELPER = 'You do one small language task at a time. Answer exactly what is asked, in plain English.';
const fillSchema = (maxWords) => ({ name: 'fill', schema: { type: 'object', properties: { text: { type: 'string', maxLength: Math.max(12, maxWords * 9) } }, required: ['text'], additionalProperties: false } });
const yesNo = (name, keys = ['yes', 'no']) => ({ name, schema: { type: 'object', properties: { answer: { type: 'string', enum: keys } }, required: ['answer'], additionalProperties: false } });
const chooseSchema = (n) => ({ name: 'choice', schema: { type: 'object', properties: { choice: { type: 'string', enum: Array.from({ length: n }, (_, i) => String(i + 1)) } }, required: ['choice'], additionalProperties: false } });

const blank = (name, view, question, maxWords, where, label) => ({
  name,
  rec: { kind: 'fill', system: SYSTEM, user: `${view}\n\n${question}\n(Answer in at most ${maxWords} words.)`, schema: fillSchema(maxWords), maxTokens: Math.min(300, maxWords * 3 + 24), meta: { phase: 'blank', question, maxWords }, where },
  label
});
const helper = (name, task, input, label, keys) => ({
  name,
  rec: { kind: `helper:${name.split(' ')[0]}`, system: HELPER, user: `${task}\n\n${input}`, schema: yesNo(name.split(' ')[0], keys), maxTokens: 16, meta: { phase: 'helper', helper: name.split(' ')[0], task, input } },
  label
});

export const CANARIES = [
  blank('parts of an empty Venus',
    'You are in the web "Venus" — the inside of Venus.\nNothing is in focus.\nThis web is empty.\nOther webs: Home',
    'What are the main parts of Venus? Name the parts you could point to on Venus itself, not the materials it is made of. Separate them with commas.', 16,
    { web: 'Venus', topic: 'Venus', things: [] },
    { best: ['Atmosphere', 'Surface', 'Crust', 'Mantle', 'Core', 'Clouds'], acceptable: ['Volcanoes', 'Highlands', 'Plains', 'Craters', 'Ionosphere', 'Cloud layer', 'Lava plains', 'Maxwell Montes', 'Ishtar Terra', 'Aphrodite Terra'], wrong: ['No parts', 'Empty', 'Silence', 'Nothing', 'Middle', 'Rock', 'Gas', 'Sense of being inside', 'Heat'] }),
  blank('parts of a crust, in a ham sandwich',
    'You are in the web "Crust" — the inside of Crust.\nCrust is part of Bread, which is part of Ham sandwich.\nThis web is empty.\nOther webs: Ham sandwich, Home',
    'What are the main parts of Crust, as part of Bread in Ham sandwich? Name the parts you could point to on Crust itself, not the materials it is made of. Separate them with commas.', 16,
    { web: 'Crust', topic: 'Ham sandwich', things: [] },
    { best: ['Outer skin', 'Top crust', 'Bottom crust', 'Edges'], acceptable: ['Crust edge', 'Top layer', 'Bottom layer', 'Scoring marks', 'Blisters', 'Ear', 'Crumb boundary', 'Heel', 'Corners'], wrong: ['Ham', 'Cheese', 'Lettuce', 'Surface', 'Texture', 'Color', 'Flour', 'Middle'] }),
  blank('parts of a bicycle',
    'You are in the web "Bicycle" — the inside of Bicycle.\nThis web is empty.\nOther webs: Home',
    'What are the main parts of Bicycle? Name the parts you could point to on Bicycle itself, not the materials it is made of. Separate them with commas.', 16,
    { web: 'Bicycle', topic: 'Bicycle', things: [] },
    { best: ['Frame', 'Wheels', 'Handlebars', 'Pedals', 'Chain', 'Saddle'], acceptable: ['Seat', 'Brakes', 'Gears', 'Fork', 'Crank', 'Tires', 'Spokes', 'Derailleur', 'Seat post', 'Wheel'], wrong: ['Metal', 'Rubber', 'Steel', 'Speed', 'Balance', 'Middle'] }),
  blank('stages of bread baking',
    'You are in the web "Bread baking" — the inside of Bread baking.\nThis web is empty.\nOther webs: Home',
    'What are the stages of Bread baking in the order they happen? Name each stage in a few words, separated by commas.', 24,
    { web: 'Bread baking', topic: 'Bread baking', things: [] },
    { best: ['Mixing', 'Kneading', 'Rising', 'Shaping', 'Baking', 'Cooling'], acceptable: ['Proofing', 'First rise', 'Second rise', 'Fermentation', 'Measuring', 'Scoring', 'Mixing dough', 'Kneading dough', 'Shaping the loaf', 'Bulk fermentation'], wrong: ['Flour', 'Oven', 'Yeast', 'Bread', 'Crust'] }),
  blank('another part of a microscope',
    'You are in the web "Microscope" — the inside of Microscope.\nIn focus: Eyepiece — the lens you look through.\nAlso here: Objective lens',
    'Name another part of Microscope, one you could point to on Microscope itself.', 4,
    { web: 'Microscope', topic: 'Microscope', things: ['Eyepiece', 'Objective lens'] },
    { best: 'Stage', acceptable: ['Stage', 'Light source', 'Condenser', 'Focus knob', 'Coarse focus knob', 'Fine focus knob', 'Arm', 'Base', 'Nosepiece', 'Diaphragm', 'Stage clips', 'Mirror', 'Illuminator', 'Body tube', 'Revolving nosepiece'], wrong: ['Eyepiece', 'Objective lens', 'Magnification', 'Glass', 'Middle'] }),
  blank('a kind of bread',
    'You are in the web "Bread" — the inside of Bread.\nIn focus: Bread — a baked food made of flour and water.',
    'Name one kind of Bread.', 4,
    { web: 'Bread', topic: 'Bread', things: ['Crust', 'Crumb'] },
    { best: 'Sourdough', acceptable: ['Rye bread', 'Baguette', 'Ciabatta', 'Brioche', 'Pita', 'Whole wheat bread', 'Focaccia', 'Rye', 'Naan', 'Challah', 'White bread', 'White loaf', 'Sourdough bread', 'Multigrain bread', 'Flatbread', 'Cornbread'], wrong: ['Crust', 'Crumb', 'Flour', 'Loaf', 'Slice'] }),
  blank('how clouds and surface relate',
    'You are in the web "Venus" — the inside of Venus.\nIn focus: Clouds — thick clouds of sulfuric acid.\nAlso here: Surface',
    'Give the words that make "Clouds ___ Surface" a true plain sentence saying what one does to or has of the other, or "none" if neither does anything to the other.', 6,
    { web: 'Venus', topic: 'Venus', things: ['Clouds', 'Surface'] },
    { best: 'hide', acceptable: ['hide', 'cover', 'shroud', 'block sunlight from', 'trap heat over', 'conceal', 'veil', 'heat'], wrong: ['relates to', 'connects to', 'is part of'] }),
  helper('onSubject inside', 'Answer yes or no.', 'Would someone explaining venus talk about Sense of being inside?', { answer: 'no' }),
  helper('onSubject clouds', 'Answer yes or no.', 'Would someone explaining venus talk about Sulfuric acid clouds?', { answer: 'yes' }),
  helper('onSubject ridge', 'Answer yes or no.', 'Would someone explaining ham sandwich talk about Mid-Atlantic Ridge?', { answer: 'no' }),
  helper('onSubject crumb', 'Answer yes or no.', 'Would someone explaining bread talk about Crumb?', { answer: 'yes' }),
  helper('isQuality smooth', 'Is the word the name of a thing, or a word that describes a quality? Answer thing or quality.', 'Word: Smooth', { answer: 'quality' }, ['thing', 'quality']),
  helper('isQuality crust', 'Is the word the name of a thing, or a word that describes a quality? Answer thing or quality.', 'Word: Crust', { answer: 'thing' }, ['thing', 'quality']),
  {
    name: 'a choice, working on a ham sandwich',
    rec: {
      kind: 'choose', system: SYSTEM, schema: chooseSchema(5), maxTokens: 16,
      user: 'You are working on "Understand ham sandwich", at Ham sandwich: you took it up 2 moments ago.\n\nYou are in the web "Ham sandwich" — the inside of Ham sandwich.\nIn focus: Bread — sliced bread.\nAlso here: nothing else yet.\nOther webs: Quantum computing, Home\n\nWhat do you do next?\n1. add a part to Ham sandwich, connected to Bread, named ___\n2. go to the web Quantum computing\n3. give up on your goal "Understand ham sandwich"\n4. note a half-formed thought to hold onto: ___\n5. something else, as a command: ___\nAnswer with the number of one option.',
      meta: { phase: 'choose', options: ['add a part to Ham sandwich, connected to Bread, named ___', 'go to the web Quantum computing', 'give up on your goal "Understand ham sandwich"', 'note a half-formed thought to hold onto: ___', 'something else, as a command: ___'] }
    },
    label: { best: [1], acceptable: [4], bad: [2, 3] }
  }
];

/**
 * Run the canaries against a backend ({ complete }), scored with their labels.
 * @returns {Promise<{ score: number, results: Array }>}
 */
export async function runCanaries(backend, { rewardWithLabel, temperature = 0 } = {}) {
  const results = [];
  for (const c of CANARIES) {
    let content = null;
    let error = null;
    try {
      ({ content } = await backend.complete({ system: c.rec.system, user: c.rec.user, schema: c.rec.schema, maxTokens: c.rec.maxTokens, temperature }));
    } catch (err) { error = err?.message || String(err); }
    const s = content == null ? { reward: -1, reasons: [error || 'no answer'] } : rewardWithLabel(c.rec, content, c.label);
    results.push({ name: c.name, content, reward: s.reward, reasons: s.reasons });
  }
  return { score: Math.round((100 * results.reduce((a, r) => a + r.reward, 0)) / results.length) / 100, results };
}
