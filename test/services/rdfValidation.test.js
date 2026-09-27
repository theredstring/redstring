import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RDFValidation } from '../../src/services/rdfValidation.js';
import { rdfResolver } from '../../src/services/rdfResolver.js';

global.fetch = vi.fn();

describe('RDF validation: external link resolution', () => {
  let validation;

  beforeEach(() => {
    vi.resetAllMocks();
    rdfResolver.clearCache();
    validation = new RDFValidation();
  });

  const graphWith = (links) => ({ nodes: [{ id: 'n1', externalLinks: links }] });

  it('reports a link the resolver could not reach', async () => {
    // resolveURI answers an unreachable URI with a placeholder instead of
    // throwing; validation must still count it as unresolved.
    global.fetch.mockRejectedValue(new Error('Network error'));

    const { issues } = await validation._validateExternalLinkResolution(graphWith(['http://example.com/gone']), {});

    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe('external_link_resolution');
    expect(issues[0].unresolvedLinks).toEqual([
      expect.objectContaining({ nodeId: 'n1', uri: 'http://example.com/gone' })
    ]);
  });

  it('reports the same unreachable link again on the next run', async () => {
    global.fetch.mockRejectedValue(new Error('Network error'));
    const graph = graphWith(['http://example.com/gone']);

    await validation._validateExternalLinkResolution(graph, {});
    const { issues } = await validation._validateExternalLinkResolution(graph, {});

    expect(issues).toHaveLength(1);
  });

  it('does not flag a link it resolved', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      headers: new Map([['content-type', 'text/turtle']]),
      text: () => Promise.resolve('<http://example.com/here> <http://example.com/p> "v" .')
    });

    const { issues } = await validation._validateExternalLinkResolution(graphWith(['http://example.com/here']), {});

    expect(issues).toEqual([]);
  });

  it('does not flag a link on a domain known to block browsers', async () => {
    const { issues } = await validation._validateExternalLinkResolution(graphWith(['https://schema.org/Person']), {});

    expect(issues).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
