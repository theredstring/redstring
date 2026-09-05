/**
 * Tests for linkIdentifier tool
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/identifierSearch.js', () => ({
  describeIdentifier: vi.fn()
}));

import { describeIdentifier } from '../../services/identifierSearch.js';
import { linkIdentifier, normalizeIdentifier } from './linkIdentifier.js';

const baseState = () => ({
  nodePrototypes: [
    { id: 'proto-photosynthesis', name: 'Photosynthesis' },
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
  });

  it('attaches a verified DOI and carries the registered title back', async () => {
    describeIdentifier.mockResolvedValue({ label: 'A paper about leaves', description: 'Smith · Nature · 2013' });

    const result = await linkIdentifier(
      { nodeName: 'Photosynthesis', identifier: '10.1038/nature12373' },
      baseState()
    );

    expect(result.action).toBe('linkIdentifier');
    expect(result.prototypeId).toBe('proto-photosynthesis');
    expect(result.url).toBe('doi:10.1038/nature12373');
    expect(result.authority).toBe('DOI');
    expect(result.href).toBe('https://doi.org/10.1038/nature12373');
    expect(result.label).toBe('A paper about leaves');
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

    expect(result.action).toBe('linkIdentifier');
    expect(result.kind).toBe('url');
    expect(result.label).toBe(null);
  });

  it('reports a duplicate as a no-op instead of re-adding it', async () => {
    const result = await linkIdentifier(
      { nodeName: 'Chlorophyll Paper', identifier: 'https://doi.org/10.1038/nature12373' },
      baseState()
    );

    expect(result.action).toBeUndefined();
    expect(result.alreadyLinked).toBe(true);
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
    expect(result.prototypeId).toBe(null);
    expect(result.nodeName).toBe('Dog');
  });
});
