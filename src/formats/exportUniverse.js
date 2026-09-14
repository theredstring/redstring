/**
 * The export formats, as data rather than as six copies of the same handler.
 *
 * These used to live inline in NodeCanvas as six near-identical blocks, each
 * re-deriving the basename, re-reading the store and repeating the
 * blob-anchor-click dance. That was survivable while the only caller was the
 * Redstring menu, which knew it meant "the universe I'm looking at". It stopped
 * being survivable the moment export moved onto a universe SAVE SLOT, where the
 * data to export is the slot's — not the active store's — and where getting
 * that wrong hands you a correctly-named file full of another universe's work.
 *
 * So the state is a PARAMETER here. Nothing in this module reads the store; a
 * caller that wants the active universe passes it in explicitly, and a caller
 * exporting a slot passes what it read from that slot. There is no fallback to
 * "whatever is loaded", because that fallback is exactly the bug.
 */

/**
 * A universe name as a filename stem.
 *
 * Falls back rather than throwing: an export that refuses to run because a
 * universe is unnamed would be a worse answer than a file called
 * `redstring-export`.
 */
export const universeBasename = (name) => {
  const cleaned = (name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'redstring-export';
};

/**
 * Hand the browser a file.
 *
 * Kept private and in one place: every one of the six copies this replaces had
 * its own version of the anchor dance, and one of them had lost its
 * revokeObjectURL along the way.
 */
const download = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Render a universe as plain text.
 *
 * Not a serialization — a reading copy. It walks the graph summaries the
 * .redstring document already carries rather than re-deriving anything, so it
 * says exactly what the file says.
 */
const buildText = (doc, universeName) => {
  const summaries = doc.graphSummaries || {};
  const lines = [universeName || 'Redstring Universe', '==================', ''];
  for (const summary of Object.values(summaries)) {
    if (summary.text) lines.push(summary.text, '');
  }
  return lines.join('\n');
};

/**
 * Every format export offers, in the order it offers them.
 *
 * `group` is the taxonomy the old menu showed as a cramped right-hand column
 * ("Native", "Readable", "RDF") and had no room to explain. The descriptions
 * are the explanation — in particular for the RDF three, where the difference
 * that matters is whether your webs survive as named graphs (TriG) or are
 * flattened into one default graph (Turtle, N-Quads). That distinction is the
 * whole decision someone is making at that point in the list, and it is drawn
 * from what the codecs actually do — see formats/rdfExport.js.
 *
 * `run` takes the store state and returns `{ blob, extension }`. Imports are
 * dynamic and per-format so opening the modal doesn't pull the RDF codecs in.
 */
export const EXPORT_FORMATS = [
  {
    id: 'redstring',
    label: 'Redstring',
    extension: 'redstring',
    group: 'native',
    description: 'The native format. Everything: webs, definitions, positions, colors.',
    run: async (storeState) => {
      const { exportToRedstring } = await import('./redstringFormat.js');
      const doc = exportToRedstring(storeState);
      return {
        blob: new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }),
        extension: 'redstring'
      };
    }
  },
  {
    id: 'json',
    label: 'JSON',
    extension: 'json',
    group: 'native',
    // Stated plainly because it is true and slightly surprising: this is the
    // same bytes as .redstring under a name other tools will open.
    description: 'Identical to .redstring, under an extension other tools recognize.',
    run: async (storeState) => {
      const { exportToRedstring } = await import('./redstringFormat.js');
      const doc = exportToRedstring(storeState);
      return {
        blob: new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }),
        extension: 'json'
      };
    }
  },
  {
    id: 'txt',
    label: 'Plain Text',
    extension: 'txt',
    group: 'readable',
    description: 'A reading copy of every web. For sending to someone, not for loading back.',
    run: async (storeState, universeName) => {
      const { exportToRedstring } = await import('./redstringFormat.js');
      const doc = exportToRedstring(storeState);
      return {
        blob: new Blob([buildText(doc, universeName)], { type: 'text/plain' }),
        extension: 'txt'
      };
    }
  },
  {
    id: 'trig',
    label: 'TriG',
    extension: 'trig',
    group: 'rdf',
    description: 'Keeps each web as its own named graph. The RDF export that preserves structure.',
    run: async (storeState) => {
      const { exportToTrig } = await import('./rdfExport.js');
      const data = await exportToTrig(storeState);
      return { blob: new Blob([data], { type: 'application/trig' }), extension: 'trig' };
    }
  },
  {
    id: 'ttl',
    label: 'Turtle',
    extension: 'ttl',
    group: 'rdf',
    description: 'Flattens every web into one default graph. Widest tool support, loses which web a statement came from.',
    run: async (storeState) => {
      const { exportToTurtle } = await import('./rdfExport.js');
      const data = await exportToTurtle(storeState);
      return { blob: new Blob([data], { type: 'text/turtle' }), extension: 'ttl' };
    }
  },
  {
    id: 'nquads',
    label: 'N-Quads',
    extension: 'nq',
    group: 'rdf',
    description: 'One statement per line, no named graphs. For piping into other tools.',
    run: async (storeState) => {
      const { exportToRdfTurtle } = await import('./rdfExport.js');
      const data = await exportToRdfTurtle(storeState);
      return { blob: new Blob([data], { type: 'application/n-quads' }), extension: 'nq' };
    }
  }
];

export const getExportFormat = (id) => EXPORT_FORMATS.find(f => f.id === id) || null;

/**
 * Run one export and hand the result to the browser.
 *
 * @param {string} formatId one of EXPORT_FORMATS' ids
 * @param {object} storeState the state to export — REQUIRED, never defaulted
 * @param {string} universeName names the file, and titles the text export
 * @returns {Promise<{ fileName: string }>}
 */
export const exportUniverseAs = async (formatId, storeState, universeName) => {
  const format = getExportFormat(formatId);
  if (!format) throw new Error(`Unknown export format: ${formatId}`);
  if (!storeState) throw new Error('Nothing to export: no universe data was provided');

  const { blob, extension } = await format.run(storeState, universeName);
  const fileName = `${universeBasename(universeName)}.${extension}`;
  download(blob, fileName);
  return { fileName };
};

export default exportUniverseAs;
