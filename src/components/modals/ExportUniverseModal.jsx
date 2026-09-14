import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, FileText, HardDrive, GitBranch, RefreshCw, Braces, Type, Share2 } from 'lucide-react';
import Modal from '../shared/Modal.jsx';
import { DialogOption } from '../shared/Dialog.jsx';
import { useTheme } from '../../hooks/useTheme.js';
import { EXPORT_FORMATS, exportUniverseAs } from '../../formats/exportUniverse.js';
import universeBackend from '../../services/universeBackend.js';

/**
 * Export one universe's LINKED FILE, in whichever format.
 *
 * The thing to understand about this modal is which data it exports. It is
 * opened from a save slot — the local file row, or the git repository row — and
 * it exports THAT SLOT, read from its own source. It deliberately does not read
 * the live store.
 *
 * That is a correction, not a preference. The download button this replaces
 * called through to `universeBackend.downloadLocalFile(slug)`, which named the
 * file after the slot's universe and then filled it from
 * `useGraphStore.getState()` — the ACTIVE one. Press it on a slot other than
 * the universe you happen to be in and you got a correctly-named file full of
 * someone else's work, with a success toast. Six formats on top of that
 * fallback would have been six ways to produce the same wrong file, so the slot
 * is read explicitly here and the store is never consulted.
 *
 * The two readers are the ones the backend already uses for exactly this — the
 * git one is what the neighbouring `downloadGitUniverse` has always done
 * correctly.
 */

const ICONS = {
  redstring: FileText,
  json: Braces,
  txt: Type,
  trig: Share2,
  ttl: Share2,
  nquads: Share2
};

const GROUP_ORDER = ['native', 'readable', 'rdf'];
const GROUP_LABELS = { native: null, readable: 'Readable', rdf: 'RDF' };

const countOf = (collection) => {
  if (!collection) return 0;
  if (collection instanceof Map || collection instanceof Set) return collection.size;
  if (Array.isArray(collection)) return collection.length;
  return Object.keys(collection).length;
};

const ExportUniverseModal = ({ isOpen, onClose, slug, source }) => {
  const theme = useTheme();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [storeState, setStoreState] = useState(null);
  const [busyFormat, setBusyFormat] = useState(null);
  const [done, setDone] = useState(null);

  const universe = useMemo(
    () => (slug ? universeBackend.getUniverse?.(slug) || null : null),
    [slug, isOpen]
  );

  const universeName = universe?.name || slug || 'Universe';

  /**
   * Where the data is being read FROM, said plainly under the title. Someone
   * exporting from a universe with both slots linked is making a choice between
   * two files that may not agree, and the path is how they tell which one they
   * opened this on.
   */
  const sourceLine = useMemo(() => {
    if (!universe) return null;
    if (source === 'git') {
      const linked = universe.gitRepo?.linkedRepo;
      if (!linked) return 'Git repository';
      const folder = universe.gitRepo?.universeFolder || universe.slug;
      const file = universe.gitRepo?.universeFile || `${universe.slug}.redstring`;
      return `@${linked.user}/${linked.repo} · ${folder}/${file}`;
    }
    const local = universe.localFile || {};
    return local.displayPath || local.path || local.lastFilePath || `${universe.slug}.redstring`;
  }, [universe, source]);

  // Read the slot when the modal opens. Done up front rather than per-format so
  // a file that cannot be read says so immediately, instead of after someone
  // has already picked a format and is waiting on a download.
  useEffect(() => {
    if (!isOpen || !universe) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    setStoreState(null);
    setDone(null);
    setBusyFormat(null);

    const read = source === 'git'
      ? universeBackend.loadFromGitDirect(universe)
      : universeBackend.loadFromLocalFile(universe);

    Promise.resolve(read)
      .then((state) => {
        if (cancelled) return;
        if (!state) {
          throw new Error(source === 'git'
            ? 'The repository file could not be read.'
            : 'The local file could not be read.');
        }
        setStoreState(state);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || 'Could not read this file.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [isOpen, universe, source]);

  const runExport = useCallback(async (formatId) => {
    if (!storeState) return;
    setBusyFormat(formatId);
    setError(null);
    try {
      const { fileName } = await exportUniverseAs(formatId, storeState, universeName);
      setDone(fileName);
    } catch (err) {
      setError(err?.message || 'Export failed.');
    } finally {
      setBusyFormat(null);
    }
  }, [storeState, universeName]);

  if (!isOpen) return null;

  const counts = storeState ? {
    graphs: countOf(storeState.graphs),
    things: countOf(storeState.nodePrototypes),
    connections: countOf(storeState.edges)
  } : null;

  const ready = Boolean(storeState) && !loading;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Export" size="medium">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        {/* What is being exported, and from where. */}
        <div style={{
          padding: '14px 16px',
          borderBottom: `1px solid ${theme.canvas.border}`,
          backgroundColor: theme.canvas.bg,
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            {source === 'git'
              ? <GitBranch size={16} style={{ color: theme.canvas.textSecondary, flexShrink: 0 }} />
              : <HardDrive size={16} style={{ color: theme.canvas.textSecondary, flexShrink: 0 }} />}
            <div style={{
              fontSize: '0.95rem',
              fontWeight: 700,
              color: theme.canvas.textPrimary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {universeName}
            </div>
          </div>

          {counts && (
            <div style={{
              fontSize: '0.75rem',
              color: theme.canvas.textSecondary,
              display: 'flex',
              gap: '14px',
              flexWrap: 'wrap'
            }}>
              <span>{counts.graphs} web{counts.graphs === 1 ? '' : 's'}</span>
              <span>{counts.things} thing{counts.things === 1 ? '' : 's'}</span>
              <span>{counts.connections} connection{counts.connections === 1 ? '' : 's'}</span>
            </div>
          )}

          <div style={{
            fontSize: '0.7rem',
            color: theme.canvas.textSecondary,
            marginTop: '6px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {sourceLine}
          </div>
        </div>

        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}>
          {loading && (
            <div style={{
              textAlign: 'center',
              padding: '24px',
              color: theme.canvas.textSecondary,
              fontSize: '0.8rem'
            }}>
              <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />
              <div style={{ marginTop: 8 }}>
                Reading {source === 'git' ? 'the repository file' : 'the local file'}…
              </div>
            </div>
          )}

          {error && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: theme.alert?.error?.text || '#c93030',
              backgroundColor: theme.alert?.error?.bg || 'rgba(201,48,48,0.1)',
              padding: '8px 10px',
              borderRadius: '4px',
              fontSize: '0.75rem'
            }}>
              <AlertCircle size={12} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {done && !error && (
            <div style={{
              fontSize: '0.75rem',
              color: theme.canvas.textSecondary,
              padding: '2px 0'
            }}>
              Saved <strong style={{ color: theme.canvas.textPrimary }}>{done}</strong>. Pick another format if you need one.
            </div>
          )}

          {ready && GROUP_ORDER.map((group, groupIndex) => {
            const formats = EXPORT_FORMATS.filter(f => f.group === group);
            if (!formats.length) return null;
            return (
              <div
                key={group}
                style={groupIndex === 0 ? undefined : {
                  marginTop: '6px',
                  paddingTop: '10px',
                  borderTop: `1px dashed ${theme.canvas.border}`
                }}
              >
                {GROUP_LABELS[group] && (
                  <div style={{
                    fontSize: '0.65rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: theme.canvas.textSecondary,
                    marginBottom: '8px'
                  }}>
                    {GROUP_LABELS[group]}
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {formats.map((format) => (
                    <DialogOption
                      key={format.id}
                      icon={ICONS[format.id] || FileText}
                      // .redstring is the expected way out of here; the rest are
                      // real doors but not the default one.
                      tone={format.id === 'redstring' ? 'primary' : 'neutral'}
                      label={busyFormat === format.id
                        ? `Exporting ${format.label}…`
                        : `${format.label} (.${format.extension})`}
                      description={format.description}
                      disabled={Boolean(busyFormat)}
                      onClick={() => runExport(format.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
};

export default ExportUniverseModal;
