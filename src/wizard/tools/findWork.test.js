/**
 * Tests for findWork tool
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/identifierSearch.js', () => ({
  searchWorks: vi.fn(),
  describeIdentifier: vi.fn()
}));

import { searchWorks } from '../../services/identifierSearch.js';
import { findWork } from './findWork.js';
import { recallVerified, clearVerified } from './utils/verifiedWorks.js';

// The real shape of the Laibson search: the article the caller wants is third,
// behind two reprints carrying the identical title.
const LAIBSON = [
  {
    url: 'doi:10.2307/j.ctvcm4j8j.20',
    doi: '10.2307/j.ctvcm4j8j.20',
    identifier: '10.2307/j.ctvcm4j8j.20',
    label: 'Golden Eggs and Hyperbolic Discounting',
    description: 'Advances in Behavioral Economics · 2011',
    journal: 'Advances in Behavioral Economics',
    year: 2011
  },
  {
    url: 'doi:10.1162/003355397555253',
    doi: '10.1162/003355397555253',
    identifier: '10.1162/003355397555253',
    label: 'Golden Eggs and Hyperbolic Discounting',
    description: 'Laibson · The Quarterly Journal of Economics · 1997',
    journal: 'The Quarterly Journal of Economics',
    year: 1997
  }
];

describe('findWork', () => {
  beforeEach(() => {
    searchWorks.mockReset();
    clearVerified();
  });

  it('returns candidates without linking anything', async () => {
    searchWorks.mockResolvedValue(LAIBSON);

    const result = await findWork({ queries: ['Golden Eggs and Hyperbolic Discounting Laibson 1997'] });

    expect(result.action).toBeUndefined();
    expect(result.results).toHaveLength(1);
    expect(result.results[0].candidates).toHaveLength(2);
  });

  it('keeps journal and year on every candidate so editions can be told apart', async () => {
    searchWorks.mockResolvedValue(LAIBSON);

    const result = await findWork({ queries: ['golden eggs'] });
    const candidates = result.results[0].candidates;

    expect(candidates.map(c => c.year)).toEqual([2011, 1997]);
    expect(candidates[1].journal).toBe('The Quarterly Journal of Economics');
  });

  it('searches every query in one call and echoes the node pairing', async () => {
    searchWorks.mockResolvedValue(LAIBSON);

    const result = await findWork({
      queries: [
        { query: 'Fitts 1954 information capacity', nodeName: 'Fitts 1954' },
        { query: 'Miller 1956 magical number seven', nodeName: 'Miller 1956' }
      ]
    });

    expect(searchWorks).toHaveBeenCalledTimes(2);
    expect(result.results.map(r => r.nodeName)).toEqual(['Fitts 1954', 'Miller 1956']);
  });

  it('files every candidate so linking one needs no second lookup', async () => {
    searchWorks.mockResolvedValue(LAIBSON);

    await findWork({ queries: ['golden eggs'] });

    expect(recallVerified('doi:10.1162/003355397555253')).toMatchObject({
      label: 'Golden Eggs and Hyperbolic Discounting'
    });
  });

  it('reports a failed search without failing the whole call', async () => {
    searchWorks
      .mockResolvedValueOnce(LAIBSON)
      .mockRejectedValueOnce(new Error('Crossref unreachable'));

    const result = await findWork({ queries: ['golden eggs', 'something else'] });

    expect(result.queriesSearched).toBe(2);
    expect(result.queriesWithCandidates).toBe(1);
    expect(result.results[1].candidates).toEqual([]);
    expect(result.results[1].error).toBe('Crossref unreachable');
  });

  // A search index ranks rather than declines, so a query for a paper nobody
  // wrote still comes back with something.
  it('drops candidates whose title is not what was asked for', async () => {
    searchWorks.mockResolvedValue([
      {
        url: 'doi:10.5281/zenodo.20646142',
        doi: '10.5281/zenodo.20646142',
        identifier: '10.5281/zenodo.20646142',
        label: 'Studie Multi-Dialektik und Ganzheitlichkeit',
        description: 'Zenodo · 2026',
        journal: 'Zenodo',
        year: 2026
      },
      {
        url: 'doi:10.2307/1914185',
        doi: '10.2307/1914185',
        identifier: '10.2307/1914185',
        label: 'Prospect Theory: An Analysis of Decision under Risk',
        description: 'Kahneman, Tversky · Econometrica · 1979',
        journal: 'Econometrica',
        year: 1979
      }
    ]);

    const result = await findWork({
      queries: ['Kahneman Tversky 1979 prospect theory analysis of decision under risk']
    });

    expect(result.results[0].candidates).toHaveLength(1);
    expect(result.results[0].candidates[0].doi).toBe('10.2307/1914185');
  });

  it('matches a citation-style query against the article title it names', async () => {
    searchWorks.mockResolvedValue([{
      url: 'doi:10.1037/h0055392',
      doi: '10.1037/h0055392',
      identifier: '10.1037/h0055392',
      // The query leads with author and year; the title has neither. Word
      // overlap has to carry it — edit distance would score this a poor match.
      label: 'The information capacity of the human motor system in controlling the amplitude of movement.',
      description: 'Fitts · Journal of Experimental Psychology · 1954',
      journal: 'Journal of Experimental Psychology',
      year: 1954
    }]);

    const result = await findWork({
      queries: ['Fitts 1954 information capacity of the human motor system']
    });

    expect(result.results[0].candidates).toHaveLength(1);
  });

  it('does not file a dropped candidate as verified', async () => {
    searchWorks.mockResolvedValue([{
      url: 'doi:10.5281/zenodo.99999',
      doi: '10.5281/zenodo.99999',
      identifier: '10.5281/zenodo.99999',
      label: 'Something entirely unrelated',
      description: 'Zenodo · 2026',
      journal: 'Zenodo',
      year: 2026
    }]);

    await findWork({ queries: ['Kahneman Tversky prospect theory decision risk'] });

    expect(recallVerified('doi:10.5281/zenodo.99999')).toBe(null);
  });

  it('requires at least one query', async () => {
    await expect(findWork({ queries: [] })).rejects.toThrow('queries is required');
    await expect(findWork({ queries: ['  '] })).rejects.toThrow('queries is required');
  });

  it('caps the number of queries', async () => {
    const queries = Array.from({ length: 26 }, (_, i) => `paper ${i}`);
    await expect(findWork({ queries })).rejects.toThrow('Too many queries');
  });
});
