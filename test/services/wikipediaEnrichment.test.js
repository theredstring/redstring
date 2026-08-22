import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { enrichSingle } from '../../src/wizard/services/wikipediaEnrichment.js';

/**
 * Enrichment matching had no test coverage at all, which is how two of the
 * bugs exercised here survived: an ambiguous name silently enriched to
 * nothing, and the confidence gate could not reject anything because its
 * floor for a direct hit equalled the rejection threshold.
 */

const summaryUrl = (title) =>
  `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;

function directPage(title, extract = 'An article.') {
  return {
    type: 'standard',
    title,
    extract,
    content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${title}` } }
  };
}

function disambiguationPage(title) {
  return { type: 'disambiguation', title, extract: 'May refer to:' };
}

const ok = (body) => ({ ok: true, json: async () => body });
const notFound = () => ({ ok: false, status: 404, json: async () => ({}) });

/**
 * @param {Object} pages - title -> page payload (or null for 404)
 * @param {string[]} searchResults - titles returned by the search API
 */
function installFetchMock(pages, searchResults = []) {
  const calls = [];
  global.fetch = vi.fn(async (url) => {
    calls.push(url);

    // Wikidata id lookup (pageprops) — not under test, return empty.
    if (url.includes('prop=pageprops')) {
      return ok({ query: { pages: {} } });
    }

    // Search API, used to expand a disambiguation page.
    if (url.includes('list=search')) {
      return ok({ query: { search: searchResults.map((title) => ({ title })) } });
    }

    // Summary API.
    const match = Object.keys(pages).find((title) => url === summaryUrl(title));
    if (match === undefined) return notFound();
    const page = pages[match];
    return page === null ? notFound() : ok(page);
  });
  return calls;
}

let originalFetch;
beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

describe('wikipedia enrichment — disambiguation', () => {
  it('resolves an ambiguous name instead of silently giving up', async () => {
    // The real-world shape: searching "Mercury" returns the disambiguation
    // page itself as the top hit. Taking options[0] fetched that same page
    // back and produced no enrichment at all.
    installFetchMock(
      {
        Mercury: disambiguationPage('Mercury'),
        'Mercury (disambiguation)': disambiguationPage('Mercury (disambiguation)'),
        'Mercury (planet)': directPage('Mercury (planet)', 'The smallest planet.')
      },
      ['Mercury (disambiguation)', 'Mercury (planet)']
    );

    const result = await enrichSingle('Mercury');
    expect(result).not.toBeNull();
    expect(result.searchResult.page.title).toBe('Mercury (planet)');
  });

  it('skips list/index pages when choosing among options', async () => {
    installFetchMock(
      {
        Java: disambiguationPage('Java'),
        'List of Java topics': directPage('List of Java topics'),
        'Java (programming language)': directPage('Java (programming language)')
      },
      ['List of Java topics', 'Java (programming language)']
    );

    const result = await enrichSingle('Java');
    expect(result?.searchResult.page.title).toBe('Java (programming language)');
  });

  it('returns null when no option resolves to a real article', async () => {
    installFetchMock(
      { Nothing: disambiguationPage('Nothing') },
      ['Nothing (disambiguation)']
    );
    expect(await enrichSingle('Nothing')).toBeNull();
  });
});

describe('wikipedia enrichment — confidence gate', () => {
  it('accepts an exact title match with high confidence', async () => {
    installFetchMock({ Photosynthesis: directPage('Photosynthesis') });
    const result = await enrichSingle('Photosynthesis');
    expect(result).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('rejects a direct hit whose title is unrelated to the query', async () => {
    // The gate previously could not reject ANY direct hit: the base score for
    // "Wikipedia returned an article" was 0.40 against a 0.40 threshold with a
    // strict `<`, so unrelated articles were applied at full confidence.
    installFetchMock({ Zorbulator: directPage('Ancient Roman cuisine') });
    expect(await enrichSingle('Zorbulator')).toBeNull();
  });

  it('still accepts a containment match (query inside the title)', async () => {
    installFetchMock({ Mitochondria: directPage('Mitochondria in cell biology') });
    const result = await enrichSingle('Mitochondria');
    expect(result).not.toBeNull();
    expect(result.confidence).toBeGreaterThanOrEqual(0.40);
  });
});
