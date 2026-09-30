/**
 * S-40 / S-42 / S-46 — rendered components never put an unsafe URL in an
 * href or a window.open, and never an unsafe colour in a style.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../../../src/services/identifierSearch.js', () => ({
  searchIdentifiers: vi.fn(async () => []),
  describeIdentifier: vi.fn(async () => null),
}));
vi.mock('../../../src/services/conceptEnrichment.js', () => ({
  wikipediaTitleFromLinks: vi.fn(async () => null),
  linkedWikipediaTitle: vi.fn(() => null),
}));

import AboutSection from '../../../src/components/panel/AboutSection.jsx';
import { toHex6Color } from '../../../src/utils/safeColor.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const UNSAFE = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)//www.wikidata.org/wiki/Q1',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
];

const hrefs = (container) => [...container.querySelectorAll('[href]')].map((el) => el.getAttribute('href'));
const isSafe = (href) => /^(https?:\/\/|mailto:|#)/i.test(href);

describe('AboutSection', () => {
  it('renders unsafe identifiers as text, with no link and no open button', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const nodeData = {
      id: 'p1',
      name: 'Alpha',
      externalLinks: [...UNSAFE, 'https://www.wikidata.org/wiki/Q42'],
      semanticMetadata: {
        origin: { label: 'Elsewhere', href: 'javascript:alert(2)' },
      },
    };
    const { container, getAllByTitle } = render(<AboutSection nodeData={nodeData} onNodeUpdate={() => {}} />);

    for (const href of hrefs(container)) expect(isSafe(href), href).toBe(true);

    // Exactly one open button: the safe Wikidata row.
    const openButtons = getAllByTitle(/^Open in /);
    expect(openButtons).toHaveLength(1);
    fireEvent.click(openButtons[0]);
    expect(open).toHaveBeenCalledWith('https://www.wikidata.org/wiki/Q42', '_blank', 'noopener,noreferrer');

    // The unsafe identifiers are still visible as text.
    expect(container.textContent).toContain('vbscript:msgbox(1)');
  });

  it('shows the origin as a link only when it is a web URL', () => {
    const { container } = render(<AboutSection nodeData={{
      id: 'p2',
      name: 'Beta',
      semanticMetadata: { originMetadata: { source: 'external', originalUri: 'data:text/html,x' } },
    }} onNodeUpdate={() => {}} />);
    for (const href of hrefs(container)) expect(isSafe(href), href).toBe(true);
  });
});

describe('ConceptDetailView', () => {
  it('renders no link for unsafe externalLinks', async () => {
    const { default: ConceptDetailView } = await import('../../../src/components/panel/views/ConceptDetailView.jsx');
    const { DndProvider } = await import('react-dnd');
    const { HTML5Backend } = await import('react-dnd-html5-backend');
    const concept = {
      id: 'c1',
      name: 'Gamma',
      color: 'url(https://evil.example/x)',
      semanticMetadata: { externalLinks: [...UNSAFE, 'https://en.wikipedia.org/wiki/Gamma'] },
    };
    const { container } = render(
      <DndProvider backend={HTML5Backend}>
        <ConceptDetailView concept={concept} onBack={() => {}} />
      </DndProvider>
    );
    const all = hrefs(container);
    for (const href of all) expect(isSafe(href), href).toBe(true);
    expect(all).toContain('https://en.wikipedia.org/wiki/Gamma');
  });
});

describe('static sinks', () => {
  const src = (path) => readFileSync(join(__dirname, '../../../src', path), 'utf8');

  it('SharedPanelContent parses Wikipedia HTML with DOMParser, never innerHTML (S-44)', () => {
    const file = src('components/panel/SharedPanelContent.jsx');
    expect(file).not.toMatch(/\.innerHTML\s*=/);
    expect(file).toMatch(/new DOMParser\(\)\.parseFromString/);
  });

  it('EdgeGlowIndicator only concatenates a sanitized hex colour into cssText (S-42)', () => {
    const file = src('components/EdgeGlowIndicator.jsx');
    expect(file).toMatch(/const color = glowColor\(rawColor\)/);
    expect(toHex6Color('red;background:url(x)', '#8B0000')).toBe('#8B0000');
    expect(toHex6Color('#abc', null)).toBe('#aabbcc');
    expect(toHex6Color('#AABBCCDD', null)).toBe('#AABBCC');
    expect(toHex6Color('maroon', '#8B0000')).toBe('#8B0000');
  });

  it('AgentConfigEditor has no API key field (S-47)', () => {
    expect(src('components/AgentConfigEditor.jsx')).not.toMatch(/handleChange\('apiKeyOverride'/);
  });
});
