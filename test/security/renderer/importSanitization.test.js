/* global __dirname */
/**
 * S-40 / S-42 / S-46 / S-47 — a .redstring file carrying every payload:
 * after importFromRedstring, the store holds none of them, and the legitimate
 * values next to them survive untouched.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importFromRedstring, exportToRedstring } from '../../../src/formats/redstringFormat.js';
import { importCytoscape } from '../../../src/formats/importAdapters.js';
import { isStorableLink, isStorableImage, stripSecretFields } from '../../../src/formats/sanitizeImported.js';

const FIXTURE = join(__dirname, '../../fixtures/canvas/small.redstring');

const BAD_COLOR = 'red;background:url(https://evil.example/beacon)';
const JS = 'javascript:alert(document.domain)';
const HTML = 'data:text/html,<script>alert(1)</script>';

const hostileDoc = () => {
  const doc = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const protos = doc.prototypeSpace.prototypes;
  const id = Object.keys(protos).find((key) => !key.includes('base-thing'));
  const proto = protos[id];
  proto['redstring:visualProperties'] = {
    'redstring:cognitiveColor': BAD_COLOR,
    'redstring:thumbnailSrc': JS,
    'redstring:imageSrc': HTML,
  };
  proto['rdfs:seeAlso'] = [JS, 'https://www.wikidata.org/wiki/Q42', 'doi:10.1038/nature12373', 'file:///etc/passwd', ' java\tscript:alert(1)', 'urn:isbn:0451450523'];
  proto['redstring:semanticMetadata'] = {
    wikipediaUrl: JS,
    wikidataUrl: 'https://www.wikidata.org/wiki/Q42',
    wikipediaThumbnail: HTML,
    wikipediaOriginalImage: 'https://upload.wikimedia.org/x.png',
    externalLinks: [HTML, 'https://ok.example/'],
    wikipediaAdditionalImages: [{ url: JS }, { url: 'https://upload.wikimedia.org/y.png', thumbnail: 'data:image/svg+xml,<svg onload=alert(1)>' }],
    originMetadata: { source: 'external', originalUri: 'vbscript:msgbox(1)' },
    origin: { label: 'Somewhere', href: JS },
  };
  proto['redstring:agentConfig'] = {
    enabled: true,
    prompt: 'hi',
    maxTokens: 100,
    apiKeyOverride: 'sk-or-v1-0000000000000000',
    nested: { accessToken: 'ghp_x', keep: 1 },
  };
  const graph = doc.spatialGraphs.graphs['g-small-a'];
  graph['redstring:color'] = 'url(https://evil.example/g)';
  const group = Object.values(graph['redstring:groups'])[0];
  group['redstring:color'] = 'expression(alert(1))';
  return { doc, id: id.replace(/^urn:redstring:id:/, '') };
};

const everyString = (value, out = []) => {
  if (typeof value === 'string') out.push(value);
  else if (value instanceof Map) value.forEach((v) => everyString(v, out));
  else if (value instanceof Set) value.forEach((v) => everyString(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => everyString(v, out));
  return out;
};

describe('importFromRedstring drops hostile values', () => {
  const { doc, id } = hostileDoc();
  const { storeState } = importFromRedstring(doc);
  const proto = storeState.nodePrototypes.get(id) || [...storeState.nodePrototypes.values()].find((p) => p.name === doc.prototypeSpace.prototypes[`urn:redstring:id:${id}`]?.name);

  it('found the prototype under test', () => {
    expect(proto).toBeTruthy();
  });

  it('no javascript:/vbscript:/data:text/file: string survives anywhere in the store', () => {
    const strings = everyString(storeState);
    for (const s of strings) {
      // What the browser reads a scheme from: leading C0/space and every
      // tab/newline removed.
      // eslint-disable-next-line no-control-regex
      const head = s.replace(/^[\x00-\x20]+/, '').replace(/[\t\n\r]/g, '').toLowerCase();
      expect(head.startsWith('javascript:'), s).toBe(false);
      expect(head.startsWith('vbscript:'), s).toBe(false);
      expect(head.startsWith('data:text'), s).toBe(false);
      expect(head.startsWith('file:'), s).toBe(false);
      expect(head.startsWith('data:image/svg'), s).toBe(false);
    }
  });

  it('replaces an unsafe Thing colour with the default and drops the graph colour', () => {
    expect(proto.color).toBe('#8B0000');
    expect(storeState.graphs.get('g-small-a').color).toBeUndefined();
    const group = [...storeState.graphs.get('g-small-a').groups.values()][0];
    expect(group.color).toBe('#8B0000');
  });

  it('drops unsafe image sources', () => {
    expect(proto.thumbnailSrc).toBeUndefined();
    expect(proto.imageSrc).toBeUndefined();
    expect(proto.semanticMetadata.wikipediaThumbnail).toBeUndefined();
    expect(proto.semanticMetadata.wikipediaOriginalImage).toBe('https://upload.wikimedia.org/x.png');
    expect(proto.semanticMetadata.wikipediaAdditionalImages).toEqual([{ url: 'https://upload.wikimedia.org/y.png' }]);
  });

  it('keeps legitimate identifiers, in order, and drops the unsafe ones', () => {
    expect(proto.externalLinks).toEqual(['https://www.wikidata.org/wiki/Q42', 'doi:10.1038/nature12373', 'urn:isbn:0451450523']);
    expect(proto.semanticMetadata.externalLinks).toEqual(['https://ok.example/']);
    expect(proto.semanticMetadata.wikipediaUrl).toBeUndefined();
    expect(proto.semanticMetadata.wikidataUrl).toBe('https://www.wikidata.org/wiki/Q42');
    expect(proto.semanticMetadata.originMetadata.originalUri).toBeUndefined();
    expect(proto.semanticMetadata.origin.href).toBeUndefined();
    expect(proto.semanticMetadata.origin.label).toBe('Somewhere');
  });

  it('strips credentials from agentConfig and keeps the rest (S-47)', () => {
    expect(proto.agentConfig).toEqual({ enabled: true, prompt: 'hi', maxTokens: 100, nested: { keep: 1 } });
  });
});

describe('export never writes an agentConfig credential (S-47)', () => {
  it('strips apiKeyOverride and token fields on the way out', () => {
    const { doc } = hostileDoc();
    const { storeState } = importFromRedstring(doc);
    // Put a key back in, as an older build would have held it in memory.
    for (const proto of storeState.nodePrototypes.values()) {
      if (proto.agentConfig) proto.agentConfig = { ...proto.agentConfig, apiKeyOverride: 'sk-live-secret', token: 't' };
    }
    const out = JSON.stringify(exportToRedstring(storeState));
    expect(out).not.toContain('sk-live-secret');
    expect(out).not.toContain('apiKeyOverride');
    expect(out).toContain('"maxTokens":100');
  });
});

describe('import adapters sanitize too', () => {
  it('importCytoscape drops unsafe colours and images', () => {
    const state = importCytoscape({
      elements: {
        nodes: [{ data: { id: 'a', label: 'A', color: BAD_COLOR, image: JS } }],
        edges: [],
      },
    });
    const node = [...state.nodes.values()][0];
    expect(node.color).toBe('#8B0000');
    expect(node.imageSrc).toBeUndefined();
  });
});

describe('storage predicates', () => {
  it.each([
    ['https://x.example/', true], ['http://x.example/', true], ['mailto:a@b.c', true],
    ['doi:10.1/x', true], ['wd:Q1', true], ['pubmed:1', true], ['urn:isbn:1', true], ['Q42', true],
    [JS, false], ['JAVASCRIPT:1', false], [' \x01javascript:1', false], ['java\tscript:1', false],
    [HTML, false], ['file:///x', false], ['blob:https://x/1', false], ['smb://h/s', false],
    ['ms-msdt:/id', false], ['intent://x', false], [42, false],
  ])('isStorableLink(%j) → %s', (value, want) => {
    expect(isStorableLink(value)).toBe(want);
  });

  it.each([
    ['https://x.example/a.png', true], ['data:image/png;base64,AA', true], ['blob:https://x/1', true],
    ['data:image/svg+xml;base64,PHN2Zz4=', true], // a user's own SVG upload survives load
    [JS, false], [HTML, false], ['file:///x.png', false], ['/relative.png', false],
  ])('isStorableImage(%j) → %s', (value, want) => {
    expect(isStorableImage(value)).toBe(want);
  });

  it('stripSecretFields keeps maxTokens but drops token-ish keys at any depth', () => {
    expect(stripSecretFields({ maxTokens: 1, apiKey: 'a', api_key: 'b', clientSecret: 'c', password: 'd', a: [{ refreshToken: 'e', ok: 2 }] }))
      .toEqual({ maxTokens: 1, a: [{ ok: 2 }] });
  });
});
