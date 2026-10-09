import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Library, FileInput, X } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import Dialog, { DialogButton, DialogCard, DialogCheckbox, DialogInput, DialogNote, DialogOption } from './Dialog.jsx';
import {
  createOntologyImportSession, applyOntologyImport, openImportedFolder, prepareNewUniverseFile, importIntoNewUniverse,
  estimateImportBytes, estimateUniverseBytes, githubFit,
} from '../../services/ontologyImport.js';
import useGraphStore from '../../store/graphStore.js';
import { ACCEPTED_EXTENSIONS } from '../../formats/ontology/parseRdf.js';

/**
 * Import an ontology file (OWL, Turtle, N-Triples, JSON-LD, OBO Graphs JSON)
 * into the open universe, or into a new universe with its own file.
 *
 * pick → reading → configure → working → result. Reading and planning happen
 * in a worker (services/ontologyImport.js); only the final merge touches the
 * store. Opened by the `openOntologyImport` window event, from the File menu
 * and the Universes panel; `detail.destination: 'new'` starts on a new universe.
 */

const LARGE_IMPORT = 20000;

const mb = (bytes) => fmt(Math.max(1, Math.round(bytes / (1024 * 1024))));

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

const baseName = (name) => String(name || '').replace(/\.(gz)$/i, '').replace(/\.[^.]+$/, '').trim();

/**
 * @param {Object|null|false} currentUniverse - the open universe as
 *   { name, gitLinked, hasLocalFile, heldBytes }; null while it's looked up,
 *   false when none is open
 */
export function OntologyImportDialog({ onClose, save, currentUniverse = null, initialDestination = 'current' }) {
  const currentUniverseName = currentUniverse ? currentUniverse.name : currentUniverse;
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
  const [destination, setDestination] = useState(initialDestination);
  const [newName, setNewName] = useState('');
  const [createdName, setCreatedName] = useState(null);

  useEffect(() => () => { sessionRef.current?.dispose(); sessionRef.current = null; }, []);

  // With no universe open, a new one is the only place an import can go.
  useEffect(() => { if (currentUniverseName === false) setDestination('new'); }, [currentUniverseName]);

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
      setNewName((prev) => prev || s?.ontology?.title || s?.sourceName || baseName(file.name) || 'Ontology');
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

  // GitHub carries files up to 50 MB: whether this import fits the universe
  // it's going into (services/ontologyImport.js githubFit).
  const fit = useMemo(() => {
    if (destination !== 'current' || !currentUniverse || !preview || preview.error || !preview.things) return null;
    return githubFit(currentUniverse, estimateUniverseBytes(useGraphStore.getState()), estimateImportBytes(preview));
  }, [destination, currentUniverse, preview]);
  const fitStops = fit?.verdict === 'refuse' || fit?.verdict === 'block';

  const runImport = async () => {
    const intoNew = destination === 'new';
    const name = newName.trim();
    let file = null;
    if (intoNew) {
      // First, while the click still counts: a browser opens its save dialog
      // only straight from one.
      try {
        file = await prepareNewUniverseFile(name);
      } catch (e) {
        setError(`Could not make the file for ${name}: ${e.message}`);
        setPhase('error');
        return;
      }
      if (!file) return; // cancelled the save dialog
    }
    setPhase('working');
    try {
      const built = await sessionRef.current.build(options);
      const report = intoNew
        ? await importIntoNewUniverse(built, { name, file, onCreated: () => setCreatedName(name) })
        : await applyOntologyImport(built, { save });
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
            disabled={!thingCount || fitStops || (destination === 'new' && !newName.trim())}
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
            Add to
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {currentUniverseName !== false && (
              <DialogButton
                label={currentUniverseName || 'This universe'}
                tone={destination === 'current' ? 'primary' : 'neutral'}
                onClick={() => setDestination('current')}
              />
            )}
            <DialogButton
              label="New Universe"
              tone={destination === 'new' ? 'primary' : 'neutral'}
              onClick={() => setDestination('new')}
            />
          </div>
          {destination === 'new' && (
            <DialogInput
              value={newName}
              placeholder="Universe name"
              onChange={(e) => setNewName(e.target.value)}
            />
          )}

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
          {fit?.verdict === 'refuse' && (
            <DialogNote>
              {`Too large for GitHub. This import alone is about ${mb(fit.importBytes)} MB, and GitHub sync carries up to ${mb(fit.limit)} MB.`}
            </DialogNote>
          )}
          {fit?.verdict === 'block' && (
            <DialogNote>
              {`This would make ${currentUniverseName} about ${mb(fit.totalBytes)} MB, over the ${mb(fit.limit)} MB GitHub sync carries, and it has no file on this device to keep the rest.`}
              <div style={{ marginTop: 8 }}>
                <DialogButton label="Import into a New Universe" onClick={() => setDestination('new')} />
              </div>
            </DialogNote>
          )}
          {fit?.verdict === 'warn' && (
            <DialogNote>
              {`This would make ${currentUniverseName} about ${mb(fit.totalBytes)} MB. GitHub sync pauses above ${mb(fit.limit)} MB; the file on this device keeps everything.`}
            </DialogNote>
          )}
          {!fitStops && fit?.verdict !== 'warn' && preview?.things > LARGE_IMPORT && (
            <DialogNote>
              {`Large import: about ${mb(estimateImportBytes(preview))} MB more in the universe file. Saves take longer.`}
            </DialogNote>
          )}
          <div style={{ fontSize: '0.75rem', color: theme.canvas.textSecondary, lineHeight: 1.5 }}>
            {destination === 'new'
              ? 'A new universe with its own .redstring file. The universe you have open is saved and left as it is.'
              : "Added to this universe; nothing here is removed. Undo can't take an import back, so the universe is saved first."}
          </div>
        </>
      )}

      {phase === 'working' && <Spinner text="Importing…" />}

      {phase === 'result' && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {result.universeSlug && (
            <div style={{ fontSize: '0.85rem', color: theme.canvas.textSecondary, marginBottom: 4 }}>
              {`Now open: ${createdName}`}
            </div>
          )}
          <Row label="Things added" value={result.addedPrototypeIds?.length ?? 0} />
          {!result.universeSlug && <Row label="Things already here" value={result.dedupedIds?.length ?? 0} />}
          {!result.universeSlug && <Row label="Things matched by link" value={result.mergedIds?.length ?? 0} />}
          <Row label="Webs added" value={result.addedGraphIds?.length ?? 0} />
          <Row label="Connections added" value={result.addedEdgeIds?.length ?? 0} />
        </div>
      )}

      {phase === 'error' && (
        <div style={{ fontSize: '0.85rem', color: theme.canvas.textPrimary, lineHeight: 1.5 }}>
          {error}
          <div style={{ marginTop: 8, color: theme.canvas.textSecondary, fontSize: '0.8rem' }}>
            {createdName
              ? `${createdName} was made, but the import did not finish in it. The universe you had open was not changed.`
              : 'The universe was not changed.'}
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
  const [destination, setDestination] = useState('current');
  // null while looking it up, false when no universe is open.
  const [currentUniverse, setCurrentUniverse] = useState(null);

  useEffect(() => {
    const onOpen = (event) => {
      setDestination(event?.detail?.destination === 'new' ? 'new' : 'current');
      setCurrentUniverse(null);
      setOpenCount((n) => n + 1);
      setOpen(true);
      import('../../services/universeBackend.js')
        .then(({ default: universeBackend }) => {
          const active = universeBackend.getActiveUniverse?.();
          setCurrentUniverse(active ? {
            name: active.name || active.slug,
            gitLinked: !!(active.gitRepo?.enabled && active.gitRepo?.linkedRepo),
            hasLocalFile: !!active.localFile?.enabled,
            heldBytes: active.metadata?.gitSyncHeld?.bytes || 0,
          } : false);
        })
        .catch(() => {});
    };
    window.addEventListener('openOntologyImport', onOpen);
    return () => window.removeEventListener('openOntologyImport', onOpen);
  }, []);

  const save = useCallback(async () => {
    const { default: universeBackend } = await import('../../services/universeBackend.js');
    await universeBackend.saveActiveUniverse();
  }, []);

  if (!open) return null;
  return (
    <OntologyImportDialog
      key={openCount}
      onClose={() => setOpen(false)}
      save={save}
      currentUniverse={currentUniverse}
      initialDestination={destination}
    />
  );
}
