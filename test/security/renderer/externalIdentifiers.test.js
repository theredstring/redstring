/**
 * S-40 — identifierFromUrl / isValidURL / resolveOrigin never hand an unsafe
 * URL to a link sink, and authority matching is by parsed hostname.
 */
import { describe, it, expect } from 'vitest';
import { identifierFromUrl, isValidURL, partitionIdentifiers } from '../../../src/utils/externalIdentifiers.js';
import { resolveOrigin } from '../../../src/utils/nodeOrigin.js';

const UNSAFE = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  '\x01javascript:alert(1)',
  'java\nscript:alert(1)',
  '  javascript:alert(1)',
  'javascript:alert(1)//wikidata.org',
  'javascript://www.wikidata.org/%0aalert(1)',
  'data:text/html,<script>alert(1)</script>',
  'file:///etc/passwd',
  'smb://attacker/share',
  'vbscript:msgbox(1)',
];

describe('identifierFromUrl', () => {
  it.each(UNSAFE)('gives no href for %j', (raw) => {
    const id = identifierFromUrl(raw);
    expect(id.href).toBeNull();
    expect(id.kind).toBe('url');
    expect(id.authority).toBe('Link');
  });

  it('does not let a query string or path borrow an authority', () => {
    expect(identifierFromUrl('https://evil.example/?x=wikidata.org').kind).toBe('url');
    expect(identifierFromUrl('https://evil.example/wikipedia.org/wiki/Dog').kind).toBe('url');
    expect(identifierFromUrl('https://wikidata.org.evil.example/wiki/Q1').kind).toBe('url');
    expect(identifierFromUrl('https://evilwikidata.org/wiki/Q1').kind).toBe('url');
  });

  it('still recognises the real hosts, including subdomains', () => {
    expect(identifierFromUrl('https://www.wikidata.org/wiki/Q42')).toMatchObject({ kind: 'wikidata', identifier: 'Q42' });
    expect(identifierFromUrl('https://en.m.wikipedia.org/wiki/Dog')).toMatchObject({ kind: 'wikipedia', identifier: 'Dog' });
    expect(identifierFromUrl('http://dbpedia.org/resource/Café')).toMatchObject({ kind: 'dbpedia', identifier: 'Café' });
    expect(identifierFromUrl('https://dx.doi.org/10.1038/nature12373')).toMatchObject({ kind: 'doi', identifier: '10.1038/nature12373' });
  });

  it('keeps the characters the file holds in href (DBpedia IRIs are read back)', () => {
    expect(identifierFromUrl('http://dbpedia.org/resource/Café').href).toBe('http://dbpedia.org/resource/Café');
  });

  it('builds prefixed forms on fixed https hosts, whatever follows the prefix', () => {
    expect(identifierFromUrl('doi:javascript:alert(1)').href).toMatch(/^https:\/\/doi\.org\//);
    expect(identifierFromUrl('wd:"><script>').href).toMatch(/^https:\/\/www\.wikidata\.org\//);
  });

  it('does not throw on a malformed percent escape', () => {
    expect(() => identifierFromUrl('https://en.wikipedia.org/wiki/%E0%A4%A')).not.toThrow();
  });

  it('keeps an unsafe identifier out of the standing slots', () => {
    const { slots, extras } = partitionIdentifiers({ externalLinks: ['javascript:alert(1)//wikidata.org'] });
    expect(slots.find((s) => s.kind === 'wikidata').url).toBeNull();
    expect(extras).toEqual(['javascript:alert(1)//wikidata.org']);
  });
});

describe('isValidURL', () => {
  it.each(UNSAFE)('rejects %j', (raw) => {
    expect(isValidURL(raw)).toBe(false);
  });

  it('accepts web links', () => {
    expect(isValidURL('https://example.com/x')).toBe(true);
    expect(isValidURL('http://example.com')).toBe(true);
  });
});

describe('resolveOrigin', () => {
  it.each(UNSAFE)('never returns an unsafe declared href (%j)', (raw) => {
    const origin = resolveOrigin({ semanticMetadata: { origin: { label: 'X', href: raw } } });
    expect(origin.href).toBeNull();
  });

  it.each(UNSAFE)('never returns an unsafe originalUri href (%j)', (raw) => {
    const origin = resolveOrigin({ semanticMetadata: { originMetadata: { source: 'external', originalUri: raw } } });
    expect(origin.href).toBeNull();
  });

  it('keeps a web origin as a link', () => {
    const origin = resolveOrigin({ semanticMetadata: { originMetadata: { source: 'wikidata', originalUri: 'https://www.wikidata.org/wiki/Q42' } } });
    expect(origin.href).toBe('https://www.wikidata.org/wiki/Q42');
  });
});
