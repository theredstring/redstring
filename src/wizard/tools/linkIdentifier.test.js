/**
 * Tests for linkIdentifier tool
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/identifierSearch.js', () => ({
  describeIdentifier: vi.fn(),
  searchWorks: vi.fn()
}));

import { describeIdentifier } from '../../services/identifierSearch.js';
import { linkIdentifier, normalizeIdentifier } from './linkIdentifier.js';
import { clearVerified, rememberVerified } from './utils/verifiedWorks.js';

const baseState = () => ({
  nodePrototypes: [
    { id: 'proto-photosynthesis', name: 'Photosynthesis' },
    { id: 'proto-fitts', name: 'Fitts 1954' },
    { id: 'proto-miller', name: 'Miller 1956' },
    { id: 'proto-paper', name: 'Chlorophyll Paper', externalLinks: ['doi:10.1038/nature12373'] }
  ],
  graphs: [{ id: 'graph-1', instances: [], edgeIds: [] }],
  activeGraphId: 'graph-1'
});

describe('normalizeIdentifier', () => {
  it('reads a bare DOI as a doi: link', () => {
    expect(normalizeIdentifier('10.1038/nature12373')).toBe('doi:10.1038/nature12373');
  });

  it('reads a doi.org URL as a doi: link', () => {
    expect(normalizeIdentifier('https://doi.org/10.1038/nature12373')).toBe('doi:10.1038/nature12373');
  });

  it('reads a PubMed URL as a pubmed: link', () => {
    expect(normalizeIdentifier('https://pubmed.ncbi.nlm.nih.gov/23851394/')).toBe('pubmed:23851394');
  });

  it('passes an already-prefixed identifier through', () => {
    expect(normalizeIdentifier('doi:10.1038/nature12373')).toBe('doi:10.1038/nature12373');
  });

  it('passes an ordinary URL through', () => {
    expect(normalizeIdentifier('https://www.wikidata.org/wiki/Q144')).toBe('https://www.wikidata.org/wiki/Q144');
  });

  it('rejects anything that is neither', () => {
    expect(normalizeIdentifier('not an identifier')).toBe(null);
    expect(normalizeIdentifier('')).toBe(null);
  });
});

describe('linkIdentifier', () => {
  beforeEach(() => {
    describeIdentifier.mockReset();
    clearVerified();
  });

  it('attaches a verified DOI and carries the registered title back', async () => {
    describeIdentifier.mockResolvedValue({ label: 'A paper about leaves', description: 'Smith · Nature · 2013' });

    const result = await linkIdentifier(
      { nodeName: 'Photosynthesis', identifier: '10.1038/nature12373' },
      baseState()
    );

    expect(result.action).toBe('linkIdentifier');
    expect(result.links).toHaveLength(1);
    expect(result.links[0].prototypeId).toBe('proto-photosynthesis');
    expect(result.links[0].url).toBe('doi:10.1038/nature12373');
    expect(result.links[0].authority).toBe('DOI');
    expect(result.links[0].href).toBe('https://doi.org/10.1038/nature12373');
    expect(result.links[0].label).toBe('A paper about leaves');
  });

  it('refuses a DOI no registry knows', async () => {
    describeIdentifier.mockResolvedValue(null);

    await expect(
      linkIdentifier({ nodeName: 'Photosynthesis', identifier: '10.9999/made-up' }, baseState())
    ).rejects.toThrow('could not be verified');
  });

  it('attaches a plain URL even when nothing describes it', async () => {
    describeIdentifier.mockResolvedValue(null);

    const result = await linkIdentifier(
      { nodeName: 'Photosynthesis', identifier: 'https://example.org/notes/leaves' },
      baseState()
    );

    expect(result.links).toHaveLength(1);
    expect(result.links[0].kind).toBe('url');
    expect(result.links[0].label).toBe(null);
  });

  it('reports a duplicate as a no-op instead of re-adding it', async () => {
    const result = await linkIdentifier(
      { nodeName: 'Chlorophyll Paper', identifier: 'https://doi.org/10.1038/nature12373' },
      baseState()
    );

    expect(result.links).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(describeIdentifier).not.toHaveBeenCalled();
  });

  it('rejects input that is neither a link nor a DOI', async () => {
    await expect(
      linkIdentifier({ nodeName: 'Photosynthesis', identifier: 'the nature paper' }, baseState())
    ).rejects.toThrow('not a link or a DOI');
  });

  it('requires nodeName and identifier', async () => {
    await expect(linkIdentifier({ identifier: '10.1038/nature12373' }, baseState()))
      .rejects.toThrow('nodeName is required');
    await expect(linkIdentifier({ nodeName: 'Photosynthesis' }, baseState()))
      .rejects.toThrow('identifier is required');
  });

  it('still returns an action when the node is only known client-side', async () => {
    describeIdentifier.mockResolvedValue({ label: 'Q144', description: 'domestic dog' });

    const result = await linkIdentifier(
      { nodeName: 'Dog', identifier: 'https://www.wikidata.org/wiki/Q144' },
      baseState()
    );

    expect(result.action).toBe('linkIdentifier');
    expect(result.links[0].prototypeId).toBe(null);
    expect(result.links[0].nodeName).toBe('Dog');
  });

  describe('batch form', () => {
    it('links several studies in one call', async () => {
      describeIdentifier.mockImplementation(async (url) => ({ label: `Paper at ${url}`, description: '' }));

      const result = await linkIdentifier({
        links: [
          { nodeName: 'Fitts 1954', identifier: '10.1037/h0055392' },
          { nodeName: 'Miller 1956', identifier: '10.1037/h0043158' }
        ]
      }, baseState());

      expect(result.links).toHaveLength(2);
      expect(result.linkedCount).toBe(2);
      expect(result.links.map(l => l.prototypeId)).toEqual(['proto-fitts', 'proto-miller']);
    });

    it('keeps the good links when one entry fails', async () => {
      describeIdentifier.mockImplementation(async (url) => (
        url === 'doi:10.9999/made-up' ? null : { label: 'A real paper', description: '' }
      ));

      const result = await linkIdentifier({
        links: [
          { nodeName: 'Fitts 1954', identifier: '10.1037/h0055392' },
          { nodeName: 'Miller 1956', identifier: '10.9999/made-up' }
        ]
      }, baseState());

      expect(result.links).toHaveLength(1);
      expect(result.links[0].nodeName).toBe('Fitts 1954');
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].nodeName).toBe('Miller 1956');
      expect(result.failures[0].reason).toMatch(/could not be verified/);
    });

    it('throws when every entry in the batch fails', async () => {
      describeIdentifier.mockResolvedValue(null);

      await expect(linkIdentifier({
        links: [
          { nodeName: 'Fitts 1954', identifier: '10.9999/nope' },
          { nodeName: 'Miller 1956', identifier: '10.9999/also-nope' }
        ]
      }, baseState())).rejects.toThrow(/Fitts 1954.*Miller 1956/s);
    });

    it('caps the batch size', async () => {
      const links = Array.from({ length: 31 }, (_, i) => ({ nodeName: `N${i}`, identifier: `10.1234/x${i}` }));
      await expect(linkIdentifier({ links }, baseState())).rejects.toThrow('Too many links');
    });
  });

  describe('verification memo', () => {
    it('does not re-check a DOI a search already verified', async () => {
      rememberVerified('doi:10.1162/003355397555253', {
        label: 'Golden Eggs and Hyperbolic Discounting',
        description: 'Laibson · The Quarterly Journal of Economics · 1997'
      });

      const result = await linkIdentifier(
        { nodeName: 'Photosynthesis', identifier: '10.1162/003355397555253' },
        baseState()
      );

      expect(describeIdentifier).not.toHaveBeenCalled();
      expect(result.links[0].label).toBe('Golden Eggs and Hyperbolic Discounting');
    });

    it('checks a DOI the memo has never seen', async () => {
      describeIdentifier.mockResolvedValue({ label: 'Something else', description: '' });

      await linkIdentifier({ nodeName: 'Photosynthesis', identifier: '10.1038/nature12373' }, baseState());

      expect(describeIdentifier).toHaveBeenCalledTimes(1);
    });
  });
});
