/**
 * The usability lab's scenarios — the model is the participant.
 *
 * Each scenario builds a small universe, puts the Druid somewhere in it, runs
 * ONE cycle, and scores what it did:
 *
 *   valid     it answered in shape (a real option, a non-placeholder blank)
 *   sensible  a person watching would call the move reasonable from here,
 *             and the words it filled in are usable (short, not a sentence
 *             where a name was asked, not a copy of the question)
 *   landed    the move's writes actually happened
 *
 * `sensible` lists the moves that count, `best` the one a careful person would
 * pick. The point is not a right answer — it is to see whether the interface
 * lets a small model act like it understood where it is, and which wording
 * helps. Scenarios are plain data plus a build function so the lab script and
 * the tests share them.
 */

/** Build webs of Things and connections. Returns { ids, webs }. */
export async function buildUniverse(world, spec) {
  const ids = {};
  const webs = {};
  for (const [webName, web] of Object.entries(spec.webs || {})) {
    const r = await world.act('createGraph', { name: webName, description: web.description || '' });
    if (!r.ok) throw new Error(`createGraph ${webName}: ${r.error}`);
    const gid = [...world.state().graphs.values()].filter(g => g.name === webName).pop().id;
    webs[webName] = gid;
    for (const [name, description] of Object.entries(web.things || {})) {
      const t = await world.createThing(gid, name, { description });
      if (!t.ok) throw new Error(`createThing ${name}: ${t.error}`);
      ids[name] = t.id;
    }
    for (const [a, b, rel] of web.links || []) {
      const c = await world.connect(gid, ids[a], ids[b], rel);
      if (!c.ok) throw new Error(`connect ${a}→${b}: ${c.error}`);
    }
    for (const [owner, parts] of Object.entries(web.insides || {})) {
      const inside = world.ensureInside(ids[owner]);
      for (const [name, description] of Object.entries(parts)) {
        const t = await world.createThing(inside, name, { description });
        if (t.ok) ids[name] = t.id;
      }
    }
  }
  return { ids, webs };
}

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);

/** Is a filled-in name usable? Short, not a sentence, not a placeholder. */
export function goodName(text) {
  const w = words(text);
  return w.length >= 1 && w.length <= 4 && !/[.!?]$/.test(String(text).trim()) && !/_{2,}|\.{3}/.test(text);
}

/** Is a filled-in relation usable? 1–3 words, a verb-ish phrase, not naming both ends. */
export function goodRelation(text, a, b) {
  const t = String(text || '').toLowerCase();
  const w = words(t);
  return w.length >= 1 && w.length <= 3 && !(t.includes(String(a).toLowerCase()) && t.includes(String(b).toLowerCase()));
}

export const SCENARIOS = [
  {
    name: 'fresh-druid',
    about: 'A Druid waking for the first time: only its Home web (Goal, Belief, Plan, Episode). Setting a goal or starting a web are sensible.',
    build: async (world, { seedRoles }) => {
      const { home } = await seedRoles(world);
      return { locus: { web: home, focus: null, path: [] } };
    },
    sensible: ['commitGoal', 'newWeb'],
    best: 'commitGoal',
    fill: (r) => (r.move === 'newWeb' ? goodName(r.text) : words(r.text).length >= 2 && words(r.text).length <= 10)
  },
  {
    name: 'empty-web',
    about: 'In an empty web named Kitchen. Making a Thing (named sensibly) is the obvious move.',
    build: async (world) => {
      const { webs } = await buildUniverse(world, { webs: { Kitchen: {} } });
      return { locus: { web: webs.Kitchen, focus: null, path: [] } };
    },
    sensible: ['make', 'note'],
    best: 'make',
    fill: (r) => r.move !== 'make' || goodName(r.text)
  },
  {
    name: 'undescribed-focus',
    about: 'Looking at Rock, which has no description and nothing inside.',
    build: async (world) => {
      const { webs, ids } = await buildUniverse(world, { webs: { Geology: { things: { Rock: '', Sand: 'Loose grains of worn rock.' } } } });
      return { locus: { web: webs.Geology, focus: ids.Rock, path: [] } };
    },
    sensible: ['describe', 'open', 'make', 'connect'],
    best: 'describe',
    fill: (r) => (r.move === 'describe' ? words(r.text).length >= 3 : r.move === 'connect' ? goodRelation(r.text, 'Rock', 'Sand') : r.move === 'make' || r.move === 'open' ? goodName(r.text) : true)
  },
  {
    name: 'unconnected-peers',
    about: 'Looking at River (described); Valley and Delta sit in the same web, unconnected.',
    build: async (world) => {
      const { webs, ids } = await buildUniverse(world, { webs: { Water: { things: { River: 'Water flowing in a channel toward the sea.', Valley: 'Low land between hills.', Delta: 'Sediment fanning out where a river meets the sea.' } } } });
      return { locus: { web: webs.Water, focus: ids.River, path: [] } };
    },
    sensible: ['connect', 'make', 'open', 'look'],
    best: 'connect',
    fill: (r) => (r.move === 'connect' ? goodRelation(r.text, 'River', r.chose?.split(' to ').pop()) : r.move === 'make' || r.move === 'open' ? goodName(r.text) : true)
  },
  {
    name: 'has-inside',
    about: 'Looking at Engine, whose inside holds four parts. Going inside is natural; so is following a connection.',
    build: async (world) => {
      const { webs, ids } = await buildUniverse(world, {
        webs: { Car: {
          things: { Engine: 'The machine that turns fuel into motion.', Wheel: 'A round part that turns on an axle.' },
          links: [['Engine', 'Wheel', 'drives']],
          insides: { Engine: { Piston: 'Moves up and down in a cylinder.', Crankshaft: 'Turns the pistons\' motion into rotation.', Spark_Plug: 'Ignites the fuel.', Cylinder: 'The chamber a piston moves in.' } }
        } }
      });
      return { locus: { web: webs.Car, focus: ids.Engine, path: [] } };
    },
    sensible: ['open', 'follow', 'make', 'describe', 'connect'],
    best: 'open',
    fill: () => true
  },
  {
    name: 'scratch-held',
    about: 'A half-formed thought is held in mind, in a web with a few Things. Keeping it is sensible.',
    build: async (world, { scratch }) => {
      const { webs } = await buildUniverse(world, { webs: { Weather: { things: { Rain: 'Water falling from clouds.', Cloud: 'Water droplets floating in the air.', Wind: 'Moving air.' } } } });
      await scratch(world, 'clouds carry the sea inland', 0);
      return { locus: { web: webs.Weather, focus: null, path: [] } };
    },
    sensible: ['promote', 'make', 'look', 'note'],
    best: 'promote',
    fill: (r) => r.move !== 'make' || goodName(r.text)
  },
  {
    name: 'deep-inside',
    about: 'Inside Engine, looking at Piston. Stepping back out or looking around are both reasonable.',
    build: async (world) => {
      const { webs, ids } = await buildUniverse(world, {
        webs: { Car: { things: { Engine: 'The machine that turns fuel into motion.' }, insides: { Engine: { Piston: 'Moves up and down in a cylinder.', Cylinder: 'The chamber a piston moves in.' } } } }
      });
      return { locus: { web: world.insideOf(ids.Engine), focus: ids.Piston, path: [ids.Engine] }, webs };
    },
    sensible: ['close', 'connect', 'look', 'open', 'describe', 'make'],
    best: 'connect',
    fill: (r) => (r.move === 'connect' ? goodRelation(r.text, 'Piston', 'Cylinder') : r.move === 'make' || r.move === 'open' ? goodName(r.text) : true)
  },
  {
    name: 'goal-open',
    about: 'In Home with an open goal about rivers, and a Water web that holds River. Working toward the goal is the natural move.',
    build: async (world, { seedRoles }) => {
      const { home, types } = await seedRoles(world);
      await buildUniverse(world, { webs: { Water: { things: { River: 'Water flowing in a channel toward the sea.', Valley: 'Low land between hills.' } } } });
      const g = await world.createThing(home, 'Understand how rivers shape land', { typeNodeId: types.goal });
      world.setDruid(g.id, { status: 'open' });
      return { locus: { web: home, focus: null, path: [] } };
    },
    sensible: ['pursueGoal', 'makePlan', 'breakDownGoal', 'goWeb'],
    best: 'pursueGoal',
    fill: (r) => !['makePlan', 'breakDownGoal'].includes(r.move) || (words(r.text).length >= 2 && words(r.text).length <= 10)
  },
  {
    name: 'belief-weigh',
    about: 'Looking at Canyon; a belief in the same web ("Rivers carve valleys") has not been weighed against it. Weighing it is the best move.',
    build: async (world, { seedRoles }) => {
      const { types } = await seedRoles(world);
      const { webs, ids } = await buildUniverse(world, { webs: { Land: { things: { Canyon: 'A deep valley cut through rock by a river over millions of years.', Hill: 'Raised land.' } } } });
      const b = await world.createThing(webs.Land, 'Rivers carve valleys', { typeNodeId: types.belief });
      world.setDruid(b.id, { evidence: [] });
      return { locus: { web: webs.Land, focus: ids.Canyon, path: [] } };
    },
    sensible: ['weighBelief', 'believe', 'connect', 'describe', 'open', 'make', 'specialize'],
    best: 'weighBelief',
    fill: () => true
  },
  {
    name: 'two-of-a-kind',
    about: 'Looking at Dog; Cat is in the same web and they share no kind yet. Saying what they are both kinds of is the best move.',
    build: async (world, { seedRoles }) => {
      await seedRoles(world);
      const { webs, ids } = await buildUniverse(world, { webs: { Animals: { things: { Dog: 'A loyal animal that barks.', Cat: 'A quiet animal that purrs.' } } } });
      return { locus: { web: webs.Animals, focus: ids.Dog, path: [] } };
    },
    sensible: ['generalize', 'connect', 'contrast', 'specialize', 'open', 'make', 'believe'],
    best: 'generalize',
    fill: (r) => (r.move === 'generalize' || r.move === 'specialize' || r.move === 'make' || r.move === 'open' ? goodName(r.text) : r.move === 'connect' ? goodRelation(r.text, 'Dog', 'Cat') : true)
  }
];

/**
 * Score one cycle record from runLife against a scenario.
 * @returns {{ valid, sensible, best, landed, fillOk }}
 */
export function score(scenario, record) {
  const choseValid = !!record.move;
  const fillOk = record.move ? scenario.fill({ move: record.move, text: record.text, chose: record.chose }) : false;
  const sensibleMove = scenario.sensible.includes(record.move);
  return {
    valid: choseValid && (record.text != null || !/___/.test(record.chose || '')),
    sensible: sensibleMove && fillOk,
    best: record.move === scenario.best,
    landed: !!record.result?.ok,
    fillOk
  };
}
