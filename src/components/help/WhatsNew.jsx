import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { parseChangelog, parseNote } from './whatsNewMarkdown.js';
import { APP_VERSION, compareVersions, getPreviewVersion } from './whatsNewVersion.js';
import { safeExternalHref } from '../../utils/safeUrl.js';
import './whatsNew.css';

/**
 * Help › What's New: the note (whatsNew.md), the latest release in full, and
 * every release before it, from CHANGELOG.md.
 *
 * A shipped build shows releases up to its own version, so an entry written
 * ahead of a release stays hidden until it ships. A dev build shows all of
 * them, marking the ones not released yet. Settings › Debug › Preview as
 * Version shows exactly what that version would, [Unreleased] as its entry.
 */

const PRE_RELEASE = '0.1.0-alpha';

// Loaded when Help first opens, and only once.
let sourcesPromise = null;
const loadSources = () => {
  sourcesPromise ||= Promise.all([
    import('../../../CHANGELOG.md?raw'),
    import('./whatsNew.md?raw'),
  ]).then(([changelog, note]) => ({
    entries: parseChangelog(changelog.default),
    note: parseNote(note.default),
  }));
  return sourcesPromise;
};

/** What this build shows, newest first, each marked draft or not. */
function visibleEntries(entries) {
  const preview = getPreviewVersion();
  if (preview) {
    return entries
      .filter(e => e.unreleased || compareVersions(e.version, preview) <= 0)
      .map(e => ({ ...e, version: e.version || preview, draft: false }));
  }
  if (import.meta.env.DEV) {
    return entries.map(e => ({
      ...e,
      version: e.version || 'Unreleased',
      draft: e.unreleased || compareVersions(e.version, APP_VERSION) > 0,
    }));
  }
  return entries
    .filter(e => !e.unreleased && compareVersions(e.version, APP_VERSION) <= 0)
    .map(e => ({ ...e, draft: false }));
}

function visibleNote(note) {
  if (!note) return null;
  if (!note.from) return { ...note, draft: false };
  const preview = getPreviewVersion();
  const released = compareVersions(preview || APP_VERSION, note.from) >= 0;
  if (released) return { ...note, draft: false };
  return import.meta.env.DEV && !preview ? { ...note, draft: true } : null;
}

const formatDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
};

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\s][^*]*)\*/g;

/** Bold, code, links and italic, as elements (never as HTML). */
function renderInline(text) {
  const out = [];
  let last = 0;
  let key = 0;
  for (const m of String(text).matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={key++}>{renderInline(m[1])}</strong>);
    else if (m[2] !== undefined) out.push(<code key={key++} className="whats-new-code">{m[2]}</code>);
    else if (m[3] !== undefined) {
      const href = safeExternalHref(m[4]);
      out.push(href
        ? <a key={key++} href={href} target="_blank" rel="noopener noreferrer" className="whats-new-link">{renderInline(m[3])}</a>
        : renderInline(m[3]));
    } else out.push(<em key={key++}>{renderInline(m[5])}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const Blocks = ({ blocks }) => blocks.map((block, i) => {
  if (block.type === 'heading') {
    return <div key={i} className="whats-new-group-heading">{renderInline(block.text)}</div>;
  }
  if (block.type === 'list') {
    return (
      <ul key={i} className="whats-new-list">
        {block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
      </ul>
    );
  }
  return <p key={i} className="whats-new-paragraph">{renderInline(block.text)}</p>;
});

const DraftTag = () => <span className="whats-new-draft">Not released yet</span>;

/** Releases by minor version: 0.15, 0.14 ... and the unreleased 0.0 builds. */
function groupByMinor(entries) {
  const groups = [];
  for (const entry of entries) {
    const [major, minor] = String(entry.version).split('.');
    const key = `${major}.${minor}`;
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, prerelease: compareVersions(entry.version, PRE_RELEASE) < 0, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

const EarlierRow = ({ entry, open, onToggle }) => (
  <div className="whats-new-row">
    <button type="button" className="whats-new-row-button" aria-expanded={open} onClick={onToggle}>
      <ChevronRight size={14} className={`whats-new-chevron${open ? ' open' : ''}`} />
      <span className="whats-new-row-version">{entry.version}</span>
      {entry.label && <span className="whats-new-row-label">{entry.label}</span>}
      {entry.draft && <DraftTag />}
      <span className="whats-new-row-date">{formatDate(entry.date)}</span>
    </button>
    {open && (
      <div className="whats-new-row-body">
        <Blocks blocks={entry.blocks} />
      </div>
    )}
  </div>
);

const WhatsNew = () => {
  const [sources, setSources] = useState(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());

  useEffect(() => {
    let live = true;
    loadSources()
      .then((s) => { if (live) setSources(s); })
      .catch((err) => {
        console.warn('[WhatsNew] Could not load the changelog:', err);
        if (live) setFailed(true);
      });
    return () => { live = false; };
  }, []);

  const entries = useMemo(() => (sources ? visibleEntries(sources.entries) : []), [sources]);
  const note = useMemo(() => (sources ? visibleNote(sources.note) : null), [sources]);
  const groups = useMemo(() => groupByMinor(entries.slice(1)), [entries]);

  if (failed) return <p className="whats-new-paragraph">{"The release notes couldn't be loaded."}</p>;
  if (!sources) return null;

  const [latest] = entries;
  const toggle = (version) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(version)) next.delete(version); else next.add(version);
    return next;
  });

  return (
    <div className="whats-new">
      {note && (
        <section className="whats-new-note">
          {(note.title || note.draft) && (
            <div className="whats-new-note-title">
              {note.title && renderInline(note.title)}
              {note.draft && <DraftTag />}
            </div>
          )}
          <Blocks blocks={note.blocks} />
        </section>
      )}

      {latest && (
        <section className="whats-new-latest">
          <div className="whats-new-latest-heading">
            <span className="whats-new-latest-version">
              {latest.unreleased && latest.draft ? 'The next release' : `Redstring ${latest.version}`}
            </span>
            {latest.draft && <DraftTag />}
            {latest.date && <span className="whats-new-row-date">{formatDate(latest.date)}</span>}
          </div>
          <Blocks blocks={latest.blocks} />
        </section>
      )}

      {groups.length > 0 && (
        <section className="whats-new-earlier">
          <h3 className="whats-new-earlier-heading">Earlier</h3>
          {groups.map(group => (
            <div key={group.key} className="whats-new-minor">
              <div className="settings-section-subtitle">
                {group.prerelease ? 'Before release' : group.key}
              </div>
              {group.prerelease && (
                <div className="settings-row-description whats-new-minor-description">
                  Never released. Numbered after the fact to mark milestones in development.
                </div>
              )}
              {group.entries.map(entry => (
                <EarlierRow
                  key={entry.version}
                  entry={entry}
                  open={expanded.has(entry.version)}
                  onToggle={() => toggle(entry.version)}
                />
              ))}
            </div>
          ))}
        </section>
      )}
    </div>
  );
};

export default WhatsNew;
