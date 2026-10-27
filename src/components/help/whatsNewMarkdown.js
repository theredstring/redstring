/**
 * The markdown What's New reads: CHANGELOG.md and the note above it
 * (whatsNew.md). Only what those two files use: headings, bullet lists and
 * paragraphs here; bold, italic, code and links inline (WhatsNew.jsx).
 * Comments are dropped, so either file can carry notes to its author.
 */

const COMMENT = /<!--[\s\S]*?-->/g;
const ENTRY_HEADING = /^\[([^\]]+)\](?:\s*\(([^)]*)\))?(?:\s*-\s*(\S+))?/;
const NOTE_GATE = /<!--\s*from\s+v?(\d+\.\d+\.\d+[^\s]*)\s*-->/i;

/** Headings, lists and paragraphs, in order. */
export function parseBlocks(text) {
  const blocks = [];
  let paragraph = null;
  let list = null;
  const flush = () => {
    if (paragraph) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    if (list) blocks.push({ type: 'list', items: list });
    paragraph = null;
    list = null;
  };

  for (const raw of String(text || '').replace(COMMENT, '').split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      continue;
    }
    const item = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (item) {
      if (paragraph) flush();
      (list ||= []).push(item[1]);
      continue;
    }
    // An indented line under a bullet carries that bullet on.
    if (list && /^\s+\S/.test(raw)) {
      list[list.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (list) flush();
    (paragraph ||= []).push(line.trim());
  }
  flush();
  return blocks;
}

/**
 * Keep a Changelog: each `## [version] - date` starts an entry, and everything
 * under it (its opening paragraph, ### Added and so on) is that entry's blocks.
 * `## [Unreleased]` is an entry with no date. A milestone in parentheses,
 * `## [0.2.0] (start of beta) - date`, is its `label`. The preamble is left out.
 */
export function parseChangelog(text) {
  const entries = [];
  let current = null;
  for (const block of parseBlocks(text)) {
    const match = block.type === 'heading' && block.level === 2 ? ENTRY_HEADING.exec(block.text) : null;
    if (match) {
      const version = match[1].trim();
      const unreleased = version.toLowerCase() === 'unreleased';
      current = {
        version: unreleased ? null : version,
        label: match[2]?.trim() || null,
        date: match[3] || null,
        unreleased,
        blocks: [],
      };
      entries.push(current);
    } else if (current) {
      current.blocks.push(block);
    }
  }
  return entries;
}

/**
 * The note above the latest release, or null when the file says nothing.
 * `<!-- from 1.0.0 -->` holds it back until the app reaches that version, so a
 * note can be written ahead of the release it belongs to.
 */
export function parseNote(text) {
  const gate = NOTE_GATE.exec(String(text || ''));
  const blocks = parseBlocks(text);
  if (!blocks.length) return null;
  const title = blocks[0].type === 'heading' ? blocks[0].text : null;
  return { from: gate ? gate[1] : null, title, blocks: title ? blocks.slice(1) : blocks };
}
