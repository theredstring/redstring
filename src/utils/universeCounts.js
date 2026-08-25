/**
 * Universe count display helpers.
 *
 * Discovery lists a repository's universe files before it has read any of them,
 * so counts arrive in a second pass. Until then a count is genuinely UNKNOWN —
 * which is not the same as zero, and rendering it as 0 is exactly the lie that
 * made these lists untrustworthy in the first place.
 */

/** The count keys discovery populates, mirrored flat and under `metadata`. */
export const COUNT_KEYS = ['nodeCount', 'graphCount', 'connectionCount', 'instanceCount'];

/**
 * Render one count for display: the number if we know it, "?" if we don't.
 * Reads both the flat and nested locations so it works with any discovery
 * result, cached universe config, or live universe record.
 *
 * @param {Object} item - discovered file or universe record
 * @param {string} key - e.g. 'nodeCount'
 * @returns {number|string}
 */
export const countLabel = (item, key) => {
  const value = item?.[key] ?? item?.metadata?.[key];
  return value === undefined || value === null ? '?' : value;
};

/** True when every count is known and zero — i.e. confidently empty. */
export const isKnownEmpty = (item) => {
  const counts = ['nodeCount', 'graphCount', 'connectionCount']
    .map((key) => item?.[key] ?? item?.metadata?.[key]);
  return counts.every((value) => value === 0);
};
