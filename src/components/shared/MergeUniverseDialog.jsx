import React from 'react';
import { Merge, Globe, Check } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import Dialog, { DialogButton, DialogCard, DialogCheckbox, DialogNote } from './Dialog.jsx';

/**
 * The universe-merge flow, as one component with three phases.
 *
 * Deliberately not built on ConfirmDialog: its `onCancel` runs BEFORE `onClose`,
 * so a handler that opens a follow-up dialog gets clobbered by the close that
 * follows it. This flow needs exactly that (result → "disconnect the source?"),
 * so it owns its own phases instead of fighting those semantics. Everything
 * below the phase logic is the shared dialog language from Dialog.jsx.
 */

const formatCount = (value) => (
  typeof value === 'number' && !Number.isNaN(value) ? value.toLocaleString() : '?'
);

const countsLine = (universe) => {
  if (!universe) return '';
  const webs = universe.graphCount ?? universe.raw?.metadata?.graphCount;
  const things = universe.nodeCount ?? universe.raw?.metadata?.nodeCount;
  const connections = universe.connectionCount ?? universe.raw?.metadata?.connectionCount;
  return `${formatCount(webs)} webs · ${formatCount(things)} things · ${formatCount(connections)} connections`;
};

/** One side of the "which one survives" choice. The card itself is the radio. */
const SideCard = ({ universe, recommended, selected, onSelect }) => {
  const theme = useTheme();

  return (
    <DialogCard
      selected={selected}
      onSelect={onSelect}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
    >
      {/* Fixed width so the two cards' text starts on the same line. */}
      <div style={{
        width: 30,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: selected ? theme.accent.secondary : theme.canvas.textPrimary
      }}>
        {selected ? <Check size={26} /> : <Globe size={26} />}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <span style={{
            fontSize: '0.85rem',
            fontWeight: 600,
            color: theme.canvas.textPrimary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {universe?.name}
          </span>
          {recommended && (
            <span style={{
              fontSize: '0.65rem',
              color: theme.canvas.textSecondary,
              letterSpacing: '0.04em',
              flexShrink: 0
            }}>
              RECOMMENDED
            </span>
          )}
        </div>

        <div style={{ fontSize: '0.75rem', color: theme.canvas.textSecondary }}>
          {countsLine(universe)}
        </div>
      </div>
    </DialogCard>
  );
};

const ReportRow = ({ label, value }) => {
  const theme = useTheme();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.85rem' }}>
      <span style={{ color: theme.canvas.textSecondary }}>{label}</span>
      <span style={{ color: theme.canvas.textPrimary, fontWeight: 700 }}>{value.toLocaleString()}</span>
    </div>
  );
};

const MergeUniverseDialog = ({
  isOpen,
  phase = 'choose',           // 'choose' | 'working' | 'result'
  activeUniverse,
  otherUniverse,
  destSlug,
  onDestChange,
  foldSameAs = true,
  onFoldSameAsChange,
  destination,
  incomingUniverse,
  // False when the incoming side came from a link rather than the universes
  // list: there is then nothing to disconnect and nothing left behind.
  incomingIsInList = true,
  report = null,
  error = null,
  onConfirm,
  onDisconnectSource,
  onReviewDuplicates,
  onClose
}) => {
  const theme = useTheme();
  if (!isOpen) return null;

  const duplicateCount =
    (report?.closeMatchCandidates?.length ?? 0) + (report?.sameAsCandidates?.length ?? 0);

  const destName = destination?.name || 'the destination';
  const incomingName = incomingUniverse?.name || 'the other universe';
  const switched = destination && activeUniverse && destination.slug !== activeUniverse.slug;
  const working = phase === 'working';

  const heading = phase === 'result'
    ? (error ? 'Merge failed' : 'Merge complete')
    : 'Merge universes';

  const footer = working ? null : (
    <>
      {phase === 'choose' && (
        <>
          <DialogButton label="Cancel" onClick={onClose} />
          <DialogButton label="Merge" tone="accent" icon={Merge} onClick={onConfirm} />
        </>
      )}
      {phase === 'result' && (
        <>
          {/* Deliberately the quiet button: disconnecting is a separate,
              destructive decision, not the natural end of a merge. */}
          {!error && onDisconnectSource && (
            <DialogButton label={`Disconnect ${incomingName}…`} onClick={onDisconnectSource} />
          )}
          {/* When the merge brought duplicates in, sorting them out is the
              real next step, so it takes the accent and Done steps back. */}
          {!error && duplicateCount > 0 && onReviewDuplicates ? (
            <>
              <DialogButton label="Done" onClick={onClose} />
              <DialogButton
                label={`Review ${duplicateCount} ${duplicateCount === 1 ? 'duplicate' : 'duplicates'}`}
                tone="accent"
                onClick={onReviewDuplicates}
              />
            </>
          ) : (
            <DialogButton label="Done" tone="primary" onClick={onClose} />
          )}
        </>
      )}
    </>
  );

  return (
    <Dialog
      width={520}
      // The working phase has no answer to give, so it swallows the scrim and
      // Escape rather than offering a dismissal that would leave a half-merge.
      onScrimClick={working ? undefined : onClose}
      icon={Merge}
      iconTone={error ? 'accent' : 'neutral'}
      title={heading}
      titleTone={error ? 'accent' : 'neutral'}
      subtitle={phase === 'choose'
        ? 'Both universes are combined. The one you pick keeps everything; the other is left as it is.'
        : undefined}
      footer={footer}
    >
      {phase === 'choose' && (
        <>
          <div style={{ fontSize: '0.8rem', color: theme.canvas.textSecondary }}>
            Which universe should the result live in?
          </div>
          <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <SideCard
              universe={activeUniverse}
              recommended
              selected={destSlug === activeUniverse?.slug}
              onSelect={() => onDestChange?.(activeUniverse?.slug)}
            />
            <SideCard
              universe={otherUniverse}
              selected={destSlug === otherUniverse?.slug}
              onSelect={() => onDestChange?.(otherUniverse?.slug)}
            />
          </div>

          <DialogCheckbox
            checked={foldSameAs}
            onChange={(next) => onFoldSameAsChange?.(next)}
            align="start"
            style={{ fontSize: '0.8rem', marginTop: 2 }}
            label="Combine things that share an external link"
            description="Same Wikidata or DBpedia link means the same thing. Everything else comes through as-is, duplicates included, to sort out later."
          />
        </>
      )}

      {working && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 12, padding: '30px 0', color: theme.canvas.textSecondary
        }}>
          <div style={{
            width: 16,
            height: 16,
            border: `2px solid ${theme.canvas.brand}`,
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
          <span style={{ fontSize: '0.9rem' }}>Reading "{incomingName}" and merging…</span>
          <style>{'@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }'}</style>
        </div>
      )}

      {phase === 'result' && error && (
        <div style={{ fontSize: '0.85rem', color: theme.canvas.textPrimary, lineHeight: 1.5 }}>
          {error}
          <div style={{ marginTop: 8, color: theme.canvas.textSecondary, fontSize: '0.8rem' }}>
            Neither universe was changed.
          </div>
        </div>
      )}

      {phase === 'result' && !error && report && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <ReportRow label="Things added" value={report.addedPrototypeIds?.length ?? 0} />
            <ReportRow label="Things already shared" value={report.dedupedIds?.length ?? 0} />
            <ReportRow label="Things matched by link" value={report.mergedIds?.length ?? 0} />
            <ReportRow label="Webs added" value={report.addedGraphIds?.length ?? 0} />
            <ReportRow label="Webs combined" value={report.mergedGraphIds?.length ?? 0} />
            <ReportRow label="Connections added" value={report.addedEdgeIds?.length ?? 0} />
          </div>
          {duplicateCount > 0 && (
            <DialogNote>
              <strong style={{ color: theme.canvas.textPrimary }}>
                {duplicateCount} possible {duplicateCount === 1 ? 'duplicate' : 'duplicates'} came through.
              </strong>{' '}
              They were left as they are rather than combined on a guess. Sorting them
              out is a separate step — you can do it now or whenever.
            </DialogNote>
          )}
          <div style={{ fontSize: '0.75rem', color: theme.canvas.textSecondary, lineHeight: 1.5 }}>
            {incomingIsInList
              ? `Everything now lives in "${destName}". "${incomingName}" was not changed and is still in your list.`
              : `Everything now lives in "${destName}". Nothing was written back to the link it came from.`}
            {switched && ` You're now working in "${destName}".`}
          </div>
        </>
      )}
    </Dialog>
  );
};

export default MergeUniverseDialog;
