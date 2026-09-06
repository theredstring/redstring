import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Merge, CheckCircle, HelpCircle, EyeOff, X } from 'lucide-react';
import CanvasModal from '../CanvasModal.jsx';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import useGraphStore from '../../store/graphStore.js';
import { useTheme } from '../../hooks/useTheme.js';
import { scanForDuplicates, computeCarryOver } from '../../services/duplicateScan.js';
import { performUndo } from '../../store/historyActions.js';
import '../ModalChrome.css';

/**
 * The things-merge modal.
 *
 * Replaces DuplicateManager, which rendered a global <style jsx> block (styled-jsx
 * isn't installed), hardcoded an off-palette indigo, ignored dark mode, subscribed
 * to the whole store, and was mounted three times over. This one follows the
 * SettingsModal shell and ModalChrome.css so it reads as part of the app.
 *
 * Sections are confidence bands, because that is the only axis on which the
 * decision actually differs: a shared Wikidata URI is an identity claim the user
 * already made and can be cleared in bulk; a shared name is a coincidence until
 * a person says otherwise.
 */

const BANDS = [
  { key: 'certain',  title: 'Certain',      icon: <CheckCircle size={16} />, bulk: true },
  { key: 'review',   title: 'Needs review', icon: <HelpCircle size={16} />,  bulk: false },
  { key: 'unlikely', title: 'Unlikely',     icon: <EyeOff size={16} />,      bulk: false },
];

const FACTOR_LABEL = {
  wikidata_id_match: 'same Wikidata entry',
  wikidata_id_mismatch: 'different Wikidata entries',
  dbpedia_uri_match: 'same DBpedia entry',
  wikipedia_url_match: 'same Wikipedia page',
  bidirectional_sameas: 'each links to the other',
  unidirectional_sameas: 'one links to the other',
  label_exact_match: 'same name',
  label_fuzzy_match: 'similar name',
  description_similarity: 'similar description',
};

const describeFactors = (factors) => (factors || [])
  .map((f) => FACTOR_LABEL[f.factor] || f.factor)
  .join(' · ');

/** One candidate pair. */
const PairCard = ({ candidate, onMerge, onSkip, disabled }) => {
  const theme = useTheme();
  const [survivorId, setSurvivorId] = useState(candidate.survivorId);
  const [carryFields, setCarryFields] = useState(() => new Set(candidate.carryOver.map((g) => g.field)));
  const [definitionStrategy, setDefinitionStrategy] = useState('combine');

  // The scan's suggestion is the starting point; flipping sides changes which
  // one is "the other", so the gap list has to be recomputed against the new
  // survivor. (It used to go empty on flip, silently removing every carry-over
  // option from the direction the user had just chosen.)
  const flipped = survivorId !== candidate.survivorId;
  const survivor = flipped ? candidate.loser : candidate.survivor;
  const other = flipped ? candidate.survivor : candidate.loser;

  const gaps = useMemo(
    () => (flipped ? computeCarryOver(survivor, other) : candidate.carryOver),
    [flipped, survivor, other, candidate.carryOver]
  );

  useEffect(() => {
    setCarryFields(new Set(gaps.map((g) => g.field)));
  }, [gaps]);

  const bothHaveDefinitions =
    (survivor.definitionGraphIds?.length || 0) > 0 && (other.definitionGraphIds?.length || 0) > 0;

  const toggleField = (field) => {
    setCarryFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field); else next.add(field);
      return next;
    });
  };

  // A thing can be used two ways — placed on a web, and as a connection's type.
  // Both are shown, because a thing that types many connections but sits on no
  // canvas is heavily used and used to read as "0 uses".
  const describeUses = (uses) => {
    const parts = [];
    if (uses.instances > 0) parts.push(`${uses.instances} ${uses.instances === 1 ? 'use' : 'uses'}`);
    if (uses.connections > 0) parts.push(`${uses.connections} as connection`);
    return parts.length > 0 ? parts.join(' · ') : 'unused';
  };

  const sideButton = (proto, isSurvivor, uses) => (
    <button
      type="button"
      onClick={() => setSurvivorId(proto.id)}
      style={{
        flex: 1,
        minWidth: 0,
        textAlign: 'left',
        padding: '8px 10px',
        borderRadius: 8,
        border: `2px solid ${isSurvivor ? theme.accent.primary : theme.canvas.border}`,
        background: 'transparent',
        color: theme.canvas.textPrimary,
        cursor: 'pointer',
        fontFamily: "'EmOne', sans-serif",
        transition: 'border-color 0.15s ease'
      }}
    >
      <div style={{
        fontWeight: 700, fontSize: '0.85rem',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
      }}>
        {proto.name || 'Untitled'}
      </div>
      <div style={{ fontSize: '0.7rem', color: theme.canvas.textSecondary, marginTop: 2 }}>
        {isSurvivor ? 'keeps its name' : 'merged in'} · {describeUses(uses)}
      </div>
    </button>
  );

  return (
    <div style={{
      border: `1px solid ${theme.canvas.border}`,
      borderRadius: 10,
      padding: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      opacity: disabled ? 0.5 : 1,
      pointerEvents: disabled ? 'none' : 'auto'
    }}>
      <div style={{ fontSize: '0.7rem', color: theme.canvas.textSecondary, letterSpacing: '0.03em' }}>
        {describeFactors(candidate.factors)}
        {candidate.demotedBecause && (
          <span style={{ color: theme.canvas.brandText }}>
            {' · '}{candidate.demotedBecause}
          </span>
        )}
        {candidate.alsoMatches > 0 && (
          <span style={{ color: theme.canvas.brandText }}>
            {' · '}one of {candidate.alsoMatches + 1} lookalikes
          </span>
        )}
      </div>

      {/* Sides keep their positions. They used to swap when you picked the
          other one, so the thing you clicked jumped out from under the cursor —
          and it made "(left)" and "(right)" below mean nothing. */}
      <div style={{ display: 'flex', gap: 8 }}>
        {sideButton(candidate.survivor, survivorId === candidate.survivorId, candidate.survivorUses)}
        {sideButton(candidate.loser, survivorId === candidate.loserId, candidate.loserUses)}
      </div>

      {gaps.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: '0.7rem', color: theme.canvas.textSecondary }}>Also take:</span>
          {gaps.map((gap) => (
            <label key={gap.field} style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: '0.75rem', color: theme.canvas.textPrimary, cursor: 'pointer'
            }}>
              <input
                type="checkbox"
                checked={carryFields.has(gap.field)}
                onChange={() => toggleField(gap.field)}
                style={{ accentColor: theme.accent.primary }}
              />
              {gap.label}
            </label>
          ))}
        </div>
      )}

      {bothHaveDefinitions && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: '0.7rem', color: theme.canvas.textSecondary }}>Definitions:</span>
          {/* The two names are very often identical, so the side is the only
              thing that tells these apart. It tracks the survivor choice: the
              survivor is the left card until you flip it. */}
          {[
            ['combine', 'combine both'],
            ['overwrite_with_primary', `only ${survivor.name || 'this one'}’s (${flipped ? 'right' : 'left'})`],
            ['overwrite_with_secondary', `only ${other.name || 'the other'}’s (${flipped ? 'left' : 'right'})`],
          ].map(([value, label]) => (
            <label key={value} style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: '0.75rem', color: theme.canvas.textPrimary, cursor: 'pointer'
            }}>
              <input
                type="radio"
                name={`defs-${candidate.key}`}
                checked={definitionStrategy === value}
                onChange={() => setDefinitionStrategy(value)}
                style={{ accentColor: theme.accent.primary }}
              />
              {label}
            </label>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <PanelIconButton
          label="Not the same"
          variant="outline"
          labelFontSize={12}
          title="Remembered with the universe — this pair won’t be raised again"
          onClick={() => onSkip(candidate.key)}
        />
        <PanelIconButton
          icon={Merge}
          label="Merge"
          variant="solid"
          labelFontSize={12}
          onClick={() => onMerge(candidate, {
            survivorId: survivor.id,
            loserId: other.id,
            carryOver: gaps.filter((g) => carryFields.has(g.field)),
            definitionStrategy
          })}
        />
      </div>
    </div>
  );
};

const MergeThingsModal = ({ isVisible, onClose }) => {
  const theme = useTheme();
  const [activeBand, setActiveBand] = useState('certain');
  const [result, setResult] = useState(null);
  const [mergedCount, setMergedCount] = useState(0);
  // Dismissals live in the store, not here. Held locally they were rebuilt
  // empty on every open, so the scan — which is deterministic — produced the
  // identical pair again and asked about things the user had already ruled on.
  const dismissed = useGraphStore((s) => s.mergeDismissals);
  // What this modal has done, newest last. Cmd+Z walks it back — including the
  // "Not the same" presses, which are modal-local and never reach the store's
  // history, so nothing else could undo them.
  const [actions, setActions] = useState([]);

  // Rescan whenever the things themselves change. A merge undone from anywhere
  // — Cmd+Z, the menu, the history panel — restores a prototype, and without
  // this the modal would keep showing a list that no longer matches the store.
  const nodePrototypes = useGraphStore((s) => s.nodePrototypes);

  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 900
  }));

  useEffect(() => {
    const handleResize = () => setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isCompactLayout = viewportSize.width <= 768;
  const modalWidth = isCompactLayout ? Math.min(Math.max(viewportSize.width - 24, 320), 600) : 750;
  const modalHeight = isCompactLayout ? Math.min(Math.max(viewportSize.height * 0.85, 400), 600) : 600;

  // Scan on open, not on every store change: this is O(n²) in the worst case
  // and the list would thrash under the user as they merge.
  const rescan = useCallback(() => {
    const { nodePrototypes, graphs, edges } = useGraphStore.getState();
    const scanned = scanForDuplicates(nodePrototypes, graphs, edges);
    setResult(scanned);
    return scanned;
  }, []);

  // Keyed on the prototypes Map, which immer replaces on every change, so an
  // undo from outside this modal refreshes the list. Skipped while hidden.
  useEffect(() => {
    if (!isVisible) return;
    rescan();
  }, [nodePrototypes, isVisible, rescan]);

  useEffect(() => {
    if (!isVisible) return;
    setMergedCount(0);
    setActions([]);
    // Dismissals naming a thing that has since been merged away are dead
    // weight; clearing them here keeps the list from growing forever.
    useGraphStore.getState().pruneDuplicateDismissals();
    const scanned = rescan();
    // Open on a band that has something in it. Arriving here from a universe
    // merge, the duplicates it surfaced are name matches, which land in review
    // rather than certain — so defaulting to certain would show an empty tab.
    // Only on open: the band must not jump around as pairs get cleared.
    setActiveBand(BANDS.map((b) => b.key).find((k) => scanned[k].length > 0) || 'certain');
  }, [isVisible, rescan]);

  const handleMerge = useCallback((candidate, decision) => {
    const ok = useGraphStore.getState().mergeThings(decision.survivorId, decision.loserId, {
      carryOver: decision.carryOver,
      definitionStrategy: decision.definitionStrategy
    });
    if (ok) {
      setMergedCount((n) => n + 1);
      setActions((prev) => [...prev, { type: 'merge' }]);
    }
    // The prototypes subscription rescans; this covers a no-op merge too.
    rescan();
  }, [rescan]);

  const handleSkip = useCallback((key) => {
    useGraphStore.getState().dismissDuplicatePair(key);
    setActions((prev) => [...prev, { type: 'dismiss', key }]);
  }, []);

  const undoLast = useCallback(() => {
    if (actions.length === 0) return false;
    const last = actions[actions.length - 1];
    setActions((prev) => prev.slice(0, -1));

    if (last.type === 'dismiss') {
      useGraphStore.getState().restoreDuplicatePair(last.key);
    } else {
      performUndo();
      setMergedCount((n) => Math.max(0, n - 1));
      rescan();
    }
    return true;
  }, [actions, rescan]);

  // Cmd/Ctrl+Z while the modal is open walks back what the modal did. When it
  // has nothing left of its own, the event is deliberately left alone so the
  // app's normal undo still works rather than being swallowed by an open modal.
  useEffect(() => {
    if (!isVisible) return undefined;
    const onKeyDown = (e) => {
      const isUndo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey;
      if (!isUndo) return;
      if (undoLast()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isVisible, undoLast]);

  const handleMergeAllCertain = useCallback(() => {
    const pending = (result?.certain || []).filter((c) => !dismissed[c.key]);
    const store = useGraphStore.getState();
    let merged = 0;
    for (const c of pending) {
      // Each is re-checked inside mergeThings; a pair whose thing was already
      // folded in by an earlier merge in this same loop is skipped, not fatal.
      if (store.mergeThings(c.survivorId, c.loserId, { carryOver: c.carryOver })) merged += 1;
    }
    setMergedCount((n) => n + merged);
    // One entry each, so Cmd+Z steps back through a bulk run pair by pair
    // rather than being unable to touch it.
    setActions((prev) => [...prev, ...Array.from({ length: merged }, () => ({ type: 'merge' }))]);
    rescan();
  }, [result, dismissed, rescan]);

  const bands = useMemo(() => {
    const empty = { certain: [], review: [], unlikely: [] };
    if (!result) return empty;

    const live = {
      certain: result.certain.filter((c) => !dismissed[c.key]),
      review: result.review.filter((c) => !dismissed[c.key]),
      unlikely: result.unlikely.filter((c) => !dismissed[c.key]),
    };

    // How many still-live pairs each thing appears in.
    //
    // Three things named "Dog" make three pairs, so clearing one leaves two
    // cards that look word-for-word identical to the one just merged. Without
    // saying so, a merge reads as having failed and come back. It hasn't —
    // there is simply a third copy — and the count is what makes that legible.
    const appearances = new Map();
    for (const c of [...live.certain, ...live.review, ...live.unlikely]) {
      for (const id of [c.survivorId, c.loserId]) {
        appearances.set(id, (appearances.get(id) || 0) + 1);
      }
    }
    const withCluster = (c) => {
      const others = Math.max(
        (appearances.get(c.survivorId) || 1) - 1,
        (appearances.get(c.loserId) || 1) - 1
      );
      return others > 0 ? { ...c, alsoMatches: others } : c;
    };

    return {
      certain: live.certain.map(withCluster),
      review: live.review.map(withCluster),
      unlikely: live.unlikely.map(withCluster),
    };
  }, [result, dismissed]);

  const visible = bands[activeBand] || [];

  const modalContent = (
    <div
      className={theme.darkMode ? 'modal-dark' : ''}
      style={{
        display: 'flex',
        height: '100%',
        fontFamily: "'EmOne', sans-serif",
        fontSize: isCompactLayout ? '0.85rem' : '0.9rem'
      }}
    >
      <PanelIconButton
        icon={X}
        size={18}
        title="Close"
        onClick={onClose}
        style={{
          position: 'absolute',
          top: isCompactLayout ? '12px' : '16px',
          right: isCompactLayout ? '32px' : '40px',
          zIndex: 10,
          touchAction: 'manipulation'
        }}
      />

      {!isCompactLayout && (
        <div
          className="settings-modal-sidebar modal-scroll"
          style={{
            width: '180px',
            borderRight: `1px solid ${theme.canvas.border}`,
            padding: '20px 12px',
            overflowY: 'auto',
            flexShrink: 0
          }}
        >
          <h3 className="modal-nav-heading">Duplicates</h3>
          {BANDS.map((band) => (
            <button
              key={band.key}
              type="button"
              className={`modal-nav-item ${activeBand === band.key ? 'active' : ''}`}
              aria-current={activeBand === band.key ? 'true' : undefined}
              onClick={() => setActiveBand(band.key)}
            >
              {band.icon}
              {band.title}
              <span style={{ marginLeft: 'auto', opacity: 0.7 }}>{bands[band.key].length}</span>
            </button>
          ))}
        </div>
      )}

      <div
        className="settings-modal-content modal-scroll"
        style={{
          flex: 1,
          padding: isCompactLayout ? '16px' : '24px',
          paddingTop: isCompactLayout ? '40px' : '24px',
          paddingRight: isCompactLayout ? '24px' : '32px',
          overflowY: 'auto'
        }}
      >
        {isCompactLayout && (
          <div style={{ marginBottom: '20px' }}>
            <select
              className="modal-input"
              aria-label="Confidence band"
              value={activeBand}
              onChange={(e) => setActiveBand(e.target.value)}
            >
              {BANDS.map((band) => (
                <option key={band.key} value={band.key}>
                  {band.title} ({bands[band.key].length})
                </option>
              ))}
            </select>
          </div>
        )}

        <h2 style={{
          margin: '0 0 16px 0',
          color: theme.canvas.textPrimary,
          fontSize: isCompactLayout ? '1.3rem' : '1.5rem'
        }}>
          {BANDS.find((b) => b.key === activeBand)?.title}
        </h2>

        {actions.length > 0 && (
          <p style={{ margin: '0 0 12px 0', fontSize: '0.75rem', color: theme.canvas.textSecondary }}>
            {mergedCount > 0 && `${mergedCount} merged. `}
            Cmd+Z steps back through what you have done here, merges and dismissals alike.
          </p>
        )}

        {activeBand === 'certain' && visible.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <PanelIconButton
              icon={Merge}
              label={`Merge all ${visible.length}`}
              variant="solid"
              labelFontSize={12}
              onClick={handleMergeAllCertain}
            />
          </div>
        )}

        {visible.length === 0 ? (
          <div style={{
            padding: '30px 20px',
            textAlign: 'left',
            color: theme.canvas.brandText,
            fontSize: '0.85rem',
            background: theme.canvas.inactive,
            borderRadius: 8,
            border: `1px dashed ${theme.canvas.border}`,
            fontStyle: 'italic'
          }}>
            Nothing here.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {visible.map((candidate) => (
              <PairCard
                key={candidate.key}
                candidate={candidate}
                onMerge={handleMerge}
                onSkip={handleSkip}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <CanvasModal
      isVisible={isVisible}
      onClose={onClose}
      title=""
      width={modalWidth}
      height={modalHeight}
      position="center"
      margin={isCompactLayout ? 12 : 20}
      fullScreenOverlay={true}
    >
      {modalContent}
    </CanvasModal>
  );
};

export default MergeThingsModal;
