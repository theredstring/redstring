#!/usr/bin/env node
/**
 * Build a small universe with planted flaws, for watching the Druid tend one.
 *
 *   node scripts/druid-tending-fixture.mjs <out.redstring>
 *
 * A kitchen garden, made "by a person" (so its Things count as observations):
 *   - a duplicate:      Tomato (Garden) and Tomatoes (Kitchen)
 *   - undescribed:      Compost, Trowel
 *   - unconnected:      Watering Can
 *   - a kind that is really two: eight Plants — four herbs in the Herb Bed used
 *     in Cooking, four fruit trees in the Orchard that bear Fruit
 */

import fs from 'node:fs';

const out = process.argv[2];
if (!out) { process.stderr.write('usage: druid-tending-fixture.mjs <out.redstring>\n'); process.exit(1); }
for (const k of ['log', 'info', 'debug', 'warn', 'error']) console[k] = () => {};

const { createHeadlessStore } = await import('../src/headless/createHeadlessStore.js');
const { useGraphStore } = await createHeadlessStore();
const { exportToRedstring } = await import('../src/formats/redstringFormat.js');
const { applyToolResultToStore, configureToolResultApplier } = await import('../src/services/toolResultApplier.js');
const { executeTool } = await import('../src/wizard/tools/index.js');
const { createWorld } = await import('../src/druid/world.js');
const { buildUniverse } = await import('../src/druid/lab/scenarios.js');
configureToolResultApplier({});

useGraphStore.getState().loadUniverseFromFile({
  graphs: new Map(), nodePrototypes: new Map(), edges: new Map(), openGraphIds: [], activeGraphId: null,
  activeDefinitionNodeId: null, expandedGraphIds: new Set(), rightPanelTabs: [{ type: 'home', isActive: true }],
  savedNodeIds: new Set(), savedGraphIds: new Set(), showConnectionNames: true
});
const world = createWorld({ store: useGraphStore, executeTool, applyToolResult: (n, r, id, cid) => applyToolResultToStore(n, r, id, cid, { confirmed: true }) });

const herbs = { Basil: 'A leafy herb with a sweet smell.', Mint: 'A cool-tasting herb that spreads fast.', Thyme: 'A small woody herb.', Rosemary: 'A needle-leaved herb.' };
const trees = { 'Apple Tree': 'A tree that bears apples.', 'Pear Tree': 'A tree that bears pears.', 'Plum Tree': 'A tree that bears plums.', 'Cherry Tree': 'A tree that bears cherries.' };
const { ids } = await buildUniverse(world, {
  webs: {
    Garden: {
      things: {
        Plant: 'A living thing that grows in soil.',
        'Herb Bed': 'A raised bed of herbs by the kitchen door.',
        Orchard: 'A group of fruit trees.',
        Fruit: 'The sweet part of a plant that holds seeds.',
        Cooking: 'Making food with heat.',
        Tomato: 'A red fruit grown on a vine.',
        Compost: '',
        'Watering Can': 'A can for watering plants.',
        ...herbs,
        ...trees
      },
      links: [
        ...Object.keys(herbs).flatMap(h => [[h, 'Herb Bed', 'grows in'], [h, 'Cooking', 'used in']]),
        ...Object.keys(trees).flatMap(t => [[t, 'Orchard', 'grows in'], [t, 'Fruit', 'bears']]),
        ['Compost', 'Herb Bed', 'feeds']
      ]
    },
    Kitchen: {
      things: { Tomatoes: 'Red fruits used in sauces.', Trowel: '', Stove: 'Where the cooking happens.' },
      links: [['Tomatoes', 'Stove', 'cooked on']]
    }
  }
});
for (const n of [...Object.keys(herbs), ...Object.keys(trees)]) useGraphStore.getState().setNodeType(ids[n], ids.Plant);

fs.writeFileSync(out, JSON.stringify(exportToRedstring(useGraphStore.getState())));
process.stdout.write(`wrote ${out}\n`);
process.exit(0);
