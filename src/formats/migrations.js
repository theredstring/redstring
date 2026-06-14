/**
 * Redstring format migration ledger (decision D2 of the v3→v4 refactor).
 *
 * A single, append-only, ORDERED list of pure migration steps. `runMigrations`
 * walks from a file's detected version up to the current version, applying each
 * step in order, then guarantees the canonical top-level shape so the importer
 * never has to branch on which sections to read.
 *
 * Rules for this file (see FORMAT_REFACTOR_PLAN.md §0):
 *   - Migration functions are PURE: no I/O, no store access, no `Date.now()`
 *     (timestamps are injected via the `now` argument).
 *   - Never edit a shipped step's behavior — append a new step instead.
 *   - This module must not import from redstringFormat.js (would be circular);
 *     it is intentionally self-contained.
 */

// Normalize a version string ("redstring-v2.0.0-semantic" / "2.0.0-semantic")
// to its detected form, and to a coarse integer "stage" (major version) used to
// decide which steps still need to run. Stage is robust to suffix variants like
// "2.0.0" vs "2.0.0-semantic".
const stripPrefix = (v) =>
  typeof v === 'string' && v.startsWith('redstring-v') ? v.replace('redstring-v', '') : v;

export const detectFormatVersion = (data) =>
  stripPrefix(data?.format || data?.metadata?.version || '1.0.0');

const stageOf = (version) => {
  const major = parseInt(String(stripPrefix(version)), 10);
  return Number.isFinite(major) ? major : 1;
};

// Prefer structuredClone (preserves Infinity/NaN/undefined) over a JSON clone,
// which would silently coerce them. Falls back to JSON only on ancient runtimes.
const clone = (data) =>
  typeof structuredClone === 'function' ? structuredClone(data) : JSON.parse(JSON.stringify(data));

/**
 * Guarantee the canonical top-level sections exist and are populated, drawing
 * from (in priority order) the canonical sections, the legacy block, or the v1
 * flat top-level. Idempotent: a fully-canonical document is returned unchanged.
 *
 * This is what lets `importFromRedstring` read a single shape — the historical
 * three-way "prototypeSpace vs legacy vs flat" branch lives here now.
 */
export const ensureCanonicalSections = (data) => {
  if (data?.prototypeSpace?.prototypes && data?.spatialGraphs?.graphs) {
    return data; // already canonical — leave verbatim
  }

  const prototypes =
    data?.prototypeSpace?.prototypes || data?.legacy?.nodePrototypes || data?.nodePrototypes || {};
  const graphs =
    data?.spatialGraphs?.graphs || data?.legacy?.graphs || data?.graphs || {};
  const edges =
    data?.relationships?.edges || data?.legacy?.edges || data?.edges || {};

  return {
    ...data,
    prototypeSpace: { ...(data?.prototypeSpace || {}), prototypes },
    spatialGraphs: { ...(data?.spatialGraphs || {}), graphs },
    relationships: { ...(data?.relationships || {}), edges }
  };
};

/**
 * The migration ledger. ORDERED and append-only. Each step is pure and reshapes
 * data toward the next version's canonical shape.
 *
 * Historical note on the existing steps:
 *   - 1.0.0 → 2.0.0-semantic was a STRUCTURAL change (flat top-level → separated
 *     prototypeSpace / spatialGraphs / relationships). That reshape is performed
 *     by ensureCanonicalSections, which `runMigrations` applies after the walk.
 *   - 2.0.0-semantic → 3.0.0 was metadata-only (additive versioning fields). The
 *     metadata bookkeeping is centralized in `runMigrations`.
 * Both steps therefore carry no per-step body today; the structure is in place
 * for the future 3.0.0 → 4.0.0 step (P3.3), which will have real reshaping.
 */
export const MIGRATIONS = [
  {
    from: '1.0.0',
    to: '2.0.0-semantic',
    migrate(data) {
      // Flat → separated sections; handled uniformly by ensureCanonicalSections.
      return ensureCanonicalSections(data);
    }
  },
  {
    from: '2.0.0-semantic',
    to: '3.0.0',
    migrate(data) {
      // Additive versioning only — metadata stamped by runMigrations.
      return data;
    }
  }
];

/**
 * Walk the ledger from a file's detected version up to the latest version,
 * applying each not-yet-applied step in order, then canonicalize the shape.
 *
 * @param {Object} data - parsed .redstring document (plain JSON)
 * @param {Object} [opts]
 * @param {string|null} [opts.now] - ISO timestamp to stamp on migrated metadata
 *   (injected for purity/determinism; pass a fixed value in tests)
 * @returns {{ data: Object, applied: string[] }} migrated data and the list of
 *   applied step labels (e.g. ['1.0.0→2.0.0-semantic', '2.0.0-semantic→3.0.0'])
 */
export function runMigrations(data, { now = null } = {}) {
  const startVersion = detectFormatVersion(data);
  const startStage = stageOf(startVersion);
  const steps = MIGRATIONS.filter((step) => startStage < stageOf(step.to));

  // Fast path: no version change. Canonicalize defensively (returns the same
  // reference when already canonical) WITHOUT cloning — this preserves the
  // input verbatim, including non-JSON values like Infinity/NaN that a clone
  // would coerce, and avoids cloning large current-version files on every load.
  if (steps.length === 0) {
    return { data: ensureCanonicalSections(data), applied: [] };
  }

  // Migration path: clone first so step transforms and metadata stamping never
  // mutate the caller's object.
  let working = clone(data);
  const applied = [];
  let finalTo = startVersion;

  for (const step of steps) {
    working = step.migrate(working, { now });
    applied.push(`${step.from}→${step.to}`);
    finalTo = step.to;
  }

  working = ensureCanonicalSections(working);

  working.metadata = { ...(working.metadata || {}) };
  working.metadata.version = finalTo;
  working.metadata.migrated = true;
  working.metadata.originalVersion = startVersion;
  working.metadata.migrationDate = now;
  working.metadata.migrationsApplied = applied;
  working.format = `redstring-v${finalTo}`;

  return { data: working, applied };
}
