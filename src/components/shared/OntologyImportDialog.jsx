import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Library, FileInput, X } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import Dialog, { DialogButton, DialogCard, DialogCheckbox, DialogInput, DialogNote, DialogOption } from './Dialog.jsx';
import { createOntologyImportSession, applyOntologyImport, openImportedFolder } from '../../services/ontologyImport.js';
import { ACCEPTED_EXTENSIONS } from '../../formats/ontology/parseRdf.js';

/**
 * Import an ontology file (OWL, Turtle, N-Triples, JSON-LD, OBO Graphs JSON)
 * into the open universe.
 *
 * pick → reading → configure → working → result. Reading and planning happen
 * in a worker (services/ontologyImport.js); only the final merge touches the
 * store. Opened by the `openOntologyImport` window event, from the File menu.
 */

const LARGE_IMPORT = 20000;

/**
 * Roughly what an import adds to the universe file: per Thing, and per Thing
 * placed in a web. Measured on all of Mondo (32,135 Things → 69 MB; its 46,736
 * placements in webs of kinds → 53 MB more) and ChEBI LITE (about 1.9 KB a Thing).
 */
const BYTES_PER_THING = 2150;
const BYTES_PER_PLACEMENT = 1150;
const estimatedBytes = (report) => (report.things * BYTES_PER_THING) + ((report.placements || 0) * BYTES_PER_PLACEMENT);

const DEPTHS = [
  { label: 'Just these', value: 0 },
  { label: '1 level', value: 1 },
  { label: '2 levels', value: 2 },
  { label: '3 levels', value: 3 },
  { label: 'All', value: Infinity },
];

const fmt = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '?');

const shortId = (iri) => {
  const m = String(iri).match(/\/obo\/([A-Za-z]+)_(\w+)$/);
  if (m) return `${m[1]}:${m[2]}`;
  const tail = String(iri).split(/[#/]/).pop();
  return tail || iri;
};

const describeProgress = (progress, fileName) => {
  if (!progress) return `Reading ${fileName}…`;
  if (progress.total) {
    const pct = Math.min(99, Math.round((progress.consumed / progress.total) * 100));
    return `Reading ${fileName}… ${pct}%`;
  }
  return `Reading ${fileName}… ${(progress.consumed / 1e6).toFixed(0)} MB`;
};

const Row = ({ label, value }) => {
  const theme = useTheme();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.85rem' }}>
      <span style={{ color: theme.canvas.textSecondary }}>{label}</span>
      <span style={{ color: theme.canvas.textPrimary, fontWeight: 700 }}>{fmt(value)}</span>
    </div>
  );
};

const Spinner = ({ text }) => {
  const theme = useTheme();
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '30px 0', color: theme.canvas.textSecondary }}>
      <div style={{
        width: 16, height: 16, border: `2px solid ${theme.canvas.brand}`, borderTopColor: 'transparent',
        borderRadius: '50%', animation: 'rs-onto-spin 1s linear infinite',
      }} />
      <span style={{ fontSize: '0.9rem' }}>{text}</span>
      <style>{'@keyframes rs-onto-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }'}</style>
    </div>
  );
};

export function OntologyImportDialog({ onClose, save }) {
  const theme = useTheme();
  const sessionRef = useRef(null);
  const fileInputRef = useRef(null);

  const [phase, setPhase] = useState('pick');
  const [fileName, setFileName] = useState('');
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  const [roots, setRoots] = useState([]); // [{ iri, label }]
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState([]);
  const [depth, setDepth] = useState(Infinity);
  const [includeDeprecated, setIncludeDeprecated] = useState(false);
  const [onlyMainNamespace, setOnlyMainNamespace] = useState(false);
  const [titleCase, setTitleCase] = useState(true);
  const [kindsWebs, setKindsWebs] = useState(true);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => () => { sessionRef.current?.dispose(); sessionRef.current = null; }, []);

  const mainNamespace = summary?.namespaces?.[0]?.prefix || null;
  const mixedNamespaces = (summary?.namespaces?.length || 0) > 1;

  const options = useMemo(() => ({
    roots: roots.map((r) => r.iri),
    depth,
    includeDeprecated,
    namespaces: onlyMainNamespace && mainNamespace ? [mainNamespace] : [],
    titleCase,
    kindsWebs,
  }), [roots, depth, includeDeprecated, onlyMainNamespace, mainNamespace, titleCase, kindsWebs]);

  const readFile = useCallback(async (file) => {
    if (!file) return;
    sessionRef.current?.dispose();
    const session = createOntologyImportSession();
    sessionRef.current = session;
    setFileName(file.name);
    setPhase('reading');
    setProgress(null);
    setError(null);
    try {
      const s = await session.index(file, setProgress);
      if (sessionRef.current !== session) return;
      setSummary(s);
      setPhase('configure');
    } catch (e) {
      if (sessionRef.current !== session) return;
      setError(e.message);
      setPhase('error');
    }
  }, []);

  // Root search, debounced.
  useEffect(() => {
    if (phase !== 'configure') return undefined;
    const q = query.trim();
    if (!q) { setHits([]); return undefined; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const found = await sessionRef.current?.search(q, 8);
        if (live) setHits(found || []);
      } catch { if (live) setHits([]); }
    }, 180);
    return () => { live = false; clearTimeout(t); };
  }, [query, phase]);

  // Preview counts for the current options.
  useEffect(() => {
    if (phase !== 'configure') return undefined;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const report = await sessionRef.current?.preview(options);
        if (live) setPreview(report || null);
      } catch (e) { if (live) setPreview({ error: e.message }); }
    }, 120);
    return () => { live = false; clearTimeout(t); };
  }, [options, phase]);

  const runImport = async () => {
    setPhase('working');
    try {
      const built = await sessionRef.current.build(options);
      const report = await applyOntologyImport(built, { save });
      setResult(report);
      setPhase('result');
    } catch (e) {
      setError(e.message);
      setPhase('error');
    }
  };

  const addRoot = (hit) => {
    setRoots((prev) => (prev.some((r) => r.iri === hit.iri) ? prev : [...prev, { iri: hit.iri, label: hit.label || shortId(hit.iri) }]));
    setQuery('');
    setHits([]);
  };

  const busy = phase === 'reading' || phase === 'working';
  const thingCount = preview?.things;
  const title = phase === 'result' ? 'Import complete' : phase === 'error' ? 'Import failed' : 'Import ontology';

  const footer = busy ? null : (
    <>
      {phase === 'pick' && <DialogButton label="Cancel" onClick={onClose} />}
      {phase === 'configure' && (
        <>
          <DialogButton label="Cancel" onClick={onClose} />
          <DialogButton
            label={thingCount ? `Import ${fmt(thingCount)} ${thingCount === 1 ? 'thing' : 'things'}` : 'Import'}
            tone="accent"
            icon={Library}
            disabled={!thingCount}
            onClick={runImport}
          />
        </>
      )}
      {phase === 'result' && (
        <>
          <DialogButton label="Done" onClick={onClose} />
          <DialogButton
            label={`Open ${summary?.ontology?.title || 'import'}`}
            tone="primary"
            onClick={() => { openImportedFolder(result?.folderWebId, result?.sourceId); onClose(); }}
          />
        </>
      )}
      {phase === 'error' && <DialogButton label="Done" tone="primary" onClick={onClose} />}
    </>
  );

  return (
    <Dialog
      width={540}
      onScrimClick={busy ? undefined : onClose}
      icon={Library}
      tone={phase === 'error' ? 'alert' : 'neutral'}
      title={title}
      subtitle={phase === 'pick' ? 'OWL, Turtle, N-Triples, JSON-LD or OBO Graphs JSON. Every term keeps its IRI.' : undefined}
      footer={footer}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={[...ACCEPTED_EXTENSIONS, '.gz'].join(',')}
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; readFile(f); }}
      />

      {phase === 'pick' && (
        <DialogOption icon={FileInput} label="Choose a file…" description="Read on this device. Nothing is uploaded." onClick={() => fileInputRef.current?.click()} />
      )}

      {phase === 'reading' && <Spinner text={describeProgress(progress, fileName)} />}

      {phase === 'configure' && summary && (
        <>
          <DialogCard
            role={summary.ontology?.version ? `Version ${summary.ontology.version}` : (summary.format || 'Ontology')}
            title={summary.ontology?.title || summary.sourceName || fileName}
            meta={`${fmt(summary.terms)} terms${summary.deprecated ? ` · ${fmt(summary.deprecated)} deprecated` : ''}${summary.ontology?.license ? ` · ${summary.ontology.license.replace(/^https?:\/\//, '')}` : ''}`}
          />

          <div style={{ fontSize: '0.8rem', color: theme.canvas.textSecondary }}>
            Start from
          </div>
          {roots.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {roots.map((r) => (
                <DialogButton
                  key={r.iri}
                  label={r.label}
                  icon={X}
                  title={`Remove ${r.label}`}
                  onClick={() => setRoots((prev) => prev.filter((x) => x.iri !== r.iri))}
                />
              ))}
            </div>
          )}
          <DialogInput
            value={query}
            placeholder={roots.length ? 'Add another term' : 'Search terms, or leave empty for everything'}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) addRoot(hits[0]); }}
          />
          {hits.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {hits.slice(0, 6).map((hit) => (
                <DialogCard
                  key={hit.iri}
                  title={hit.label || shortId(hit.iri)}
                  meta={shortId(hit.iri)}
                  onSelect={() => addRoot(hit)}
                />
              ))}
            </div>
          )}

          {roots.length > 0 && (
            <>
              <div style={{ fontSize: '0.8rem', color: theme.canvas.textSecondary }}>
                More specific terms
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {DEPTHS.map((d) => (
                  <DialogButton
                    key={d.label}
                    label={d.label}
                    tone={depth === d.value ? 'primary' : 'neutral'}
                    onClick={() => setDepth(d.value)}
                  />
                ))}
              </div>
            </>
          )}

          <DialogCheckbox
            checked={titleCase}
            onChange={setTitleCase}
            label="Title Case names"
            description="Off keeps the source's own labels"
            align="start"
            style={{ fontSize: '0.8rem' }}
          />
          <DialogCheckbox
            checked={kindsWebs}
            onChange={setKindsWebs}
            label="Webs of kinds"
            description="Open a Thing to see its more specific kinds"
            align="start"
            style={{ fontSize: '0.8rem' }}
          />
          <DialogCheckbox
            checked={includeDeprecated}
            onChange={setIncludeDeprecated}
            label="Include deprecated terms"
            align="start"
            style={{ fontSize: '0.8rem' }}
          />
          {mixedNamespaces && mainNamespace && (
            <DialogCheckbox
              checked={onlyMainNamespace}
              onChange={setOnlyMainNamespace}
              label={`Only ${shortId(`${mainNamespace}0`).replace(/:0$/, '')} terms`}
              description={mainNamespace}
              align="start"
              style={{ fontSize: '0.8rem' }}
            />
          )}

          {preview && !preview.error && (
            <div style={{ fontSize: '0.8rem', color: theme.canvas.textSecondary }}>
              {fmt(preview.things)} things · {fmt(preview.compositionWebs + (preview.connectionsWebs || 0) + (preview.kindsWebs || 0) + 1)} webs · {fmt(preview.connections)} connections
              {preview.slice?.ancestors ? ` · includes ${fmt(preview.slice.ancestors)} less specific terms` : ''}
            </div>
          )}
          {preview?.things > LARGE_IMPORT && (
            <DialogNote>
              {`Large import: about ${fmt(Math.round(estimatedBytes(preview) / 1e6))} MB more in the universe file, and every save writes all of it.`}
            </DialogNote>
          )}
          <div style={{ fontSize: '0.75rem', color: theme.canvas.textSecondary, lineHeight: 1.5 }}>
            {"Added to this universe; nothing here is removed. Undo can't take an import back, so the universe is saved first."}
          </div>
        </>
      )}

      {phase === 'working' && <Spinner text="Importing…" />}

      {phase === 'result' && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Row label="Things added" value={result.addedPrototypeIds?.length ?? 0} />
          <Row label="Things already here" value={result.dedupedIds?.length ?? 0} />
          <Row label="Things matched by link" value={result.mergedIds?.length ?? 0} />
          <Row label="Webs added" value={result.addedGraphIds?.length ?? 0} />
          <Row label="Connections added" value={result.addedEdgeIds?.length ?? 0} />
        </div>
      )}

      {phase === 'error' && (
        <div style={{ fontSize: '0.85rem', color: theme.canvas.textPrimary, lineHeight: 1.5 }}>
          {error}
          <div style={{ marginTop: 8, color: theme.canvas.textSecondary, fontSize: '0.8rem' }}>
            The universe was not changed.
          </div>
        </div>
      )}
    </Dialog>
  );
}

/**
 * Mount point: listens for `openOntologyImport` and owns the dialog's lifetime,
 * so each opening starts from a fresh session.
 */
export default function OntologyImportHost() {
  const [openCount, setOpenCount] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => { setOpenCount((n) => n + 1); setOpen(true); };
    window.addEventListener('openOntologyImport', onOpen);
    return () => window.removeEventListener('openOntologyImport', onOpen);
  }, []);

  const save = useCallback(async () => {
    const { default: universeBackend } = await import('../../services/universeBackend.js');
    await universeBackend.saveActiveUniverse();
  }, []);

  if (!open) return null;
  return <OntologyImportDialog key={openCount} onClose={() => setOpen(false)} save={save} />;
}
