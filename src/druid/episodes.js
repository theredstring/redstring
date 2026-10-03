/**
 * Episodes — what happened, written by the loop, not the model.
 *
 * When a cycle changes the graph, the loop records it as an episode: a Thing
 * in that day's episode web, describing the move and naming the Things it
 * touched. Episodic memory for free, and the evidence that beliefs point back
 * to. The model never writes one, so an episode cannot confabulate.
 */

export function episodeWebKey(date = new Date()) {
  return `episodes-${date.toISOString().slice(0, 10)}`;
}

/**
 * @param {Object} world
 * @param {Object} e
 * @param {number} e.tick
 * @param {string} e.summary     plain words: what was done
 * @param {string[]} e.touched   prototype ids
 * @param {string} [e.episodeTypeId]  the Episode role type, if it exists
 * @param {Date}   [e.now]
 * @returns {Promise<string|null>} the episode's id
 */
export async function writeEpisode(world, { tick, summary, touched = [], episodeTypeId = null, now = new Date() }) {
  const key = episodeWebKey(now);
  const web = world.systemWeb(key, `Episodes ${key.slice(9)}`, 'What happened, as the Druid lived it.');
  const names = touched.map(id => world.nameOf(id)).filter(Boolean);
  const r = await world.createThing(web, `Moment ${tick}`, {
    description: `${summary}${names.length ? ` (involving ${names.join(', ')})` : ''}`,
    typeNodeId: episodeTypeId
  });
  if (!r.ok) return null;
  world.setDruid(r.id, { role: 'episode', tick, touched, at: now.toISOString() });
  return r.id;
}

/** Recent episodes, newest first. */
export function recentEpisodes(world, k = 5) {
  return world.allThingsIncludingSystem()
    .filter(id => world.druidOf(id).role === 'episode')
    .sort((a, b) => (world.druidOf(b).tick ?? 0) - (world.druidOf(a).tick ?? 0))
    .slice(0, k);
}
