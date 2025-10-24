/**
 * Helper utilities for deriving universe names from repository metadata
 * while ensuring uniqueness across existing universes.
 */

const toTitleCaseSegment = (segment = '') => {
  if (!segment) return '';
  const lower = segment.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

export const formatUniverseNameFromRepo = (repoName = '') => {
  if (!repoName) return 'Universe';

  const cleaned = repoName
    .replace(/\.git$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return 'Universe';

  return cleaned
    .split(' ')
    .map(toTitleCaseSegment)
    .join(' ')
    .trim() || repoName;
};

export const buildUniqueUniverseName = (desiredName = 'Universe', universes = [], currentSlug = null) => {
  const baseName = desiredName.trim() || 'Universe';
  const existingNames = new Set(
    universes
      .filter(universe => universe?.slug && universe.slug !== currentSlug)
      .map(universe => (universe?.name || '').trim().toLowerCase())
      .filter(Boolean)
  );

  let candidate = baseName;
  let attempt = 2;

  while (existingNames.has(candidate.trim().toLowerCase())) {
    candidate = `${baseName} (${attempt})`;
    attempt += 1;
  }

  return candidate;
};

export const deriveUniqueUniverseNameFromRepo = (repoName, universes, currentSlug) => {
  const formatted = formatUniverseNameFromRepo(repoName);
  return buildUniqueUniverseName(formatted, universes, currentSlug);
};

export default {
  formatUniverseNameFromRepo,
  buildUniqueUniverseName,
  deriveUniqueUniverseNameFromRepo
};
