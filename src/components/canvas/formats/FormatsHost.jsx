/**
 * Formats on the canvas: the offer pill (in Back to Civilization's place and
 * style, with an X that waves it off for the session). Pressing it shows the
 * piece of the web as its format right where it is (formula/FormulaObjectsLayer).
 * Also hosts the New Formula composer.
 *
 * The candidate is worked out from the stores a beat after they settle, so a
 * drag or a burst of edits doesn't re-read the web on every write.
 */
import { useEffect, useRef, useState } from 'react';
import { Sigma, X } from 'lucide-react';
import useGraphStore from '../../../store/graphStore.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import { useViewportBounds } from '../../../hooks/useViewportBounds';
import { useMobileLandscapeShell } from '../../../hooks/useMobileLandscapeShell.js';
import { haptic } from '../../../services/haptics.js';
import { tokensOf } from './formula/formulaChain.js';
import FormulaTokens from './formula/FormulaTokens.jsx';
import FormulaComposer from './formula/FormulaComposer.jsx';
import useFormatsStore, { dismissFormatOffer, showFormatInPlace, selectStandard } from './formatsStore.js';
import { findFormatCandidate } from './formatCandidates.js';
import './formats.css';

const SETTLE_MS = 180;
const EXIT_MS = 150;

function useFormatCandidate(enabled) {
  const [candidate, setCandidate] = useState(null);
  useEffect(() => {
    if (!enabled) { setCandidate(null); return undefined; }
    let timer = null;
    const compute = () => {
      timer = null;
      const ui = useCanvasUIStore.getState();
      const next = findFormatCandidate(useGraphStore.getState(), {
        selectedInstanceIds: ui.selectedInstanceIds,
        selectedGroupId: ui.selectedGroupId,
        dismissed: useFormatsStore.getState().dismissed,
      });
      setCandidate(prev => (prev?.key === next?.key ? prev : next));
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(compute, SETTLE_MS);
    };
    compute();
    const unsubs = [
      useGraphStore.subscribe((s, p) => {
        if (s.graphs !== p.graphs || s.edges !== p.edges || s.nodePrototypes !== p.nodePrototypes || s.activeGraphId !== p.activeGraphId) schedule();
      }),
      useCanvasUIStore.subscribe((s, p) => {
        if (s.selectedInstanceIds !== p.selectedInstanceIds || s.selectedGroupId !== p.selectedGroupId) schedule();
      }),
      useFormatsStore.subscribe((s, p) => { if (s.dismissed !== p.dismissed) compute(); }),
    ];
    return () => {
      if (timer) clearTimeout(timer);
      unsubs.forEach(u => u());
    };
  }, [enabled]);
  return candidate;
}

/** Keeps the last value through an exit animation; `phase` is 'in' | 'steady' | 'out' | null. */
function useLatchedPresence(value) {
  const [shown, setShown] = useState(value);
  const [phase, setPhase] = useState(value ? 'in' : null);
  const timer = useRef(null);
  useEffect(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (value) {
      setShown(value);
      setPhase(p => (p === 'steady' || p === 'in' ? p : 'in'));
    } else if (shown) {
      setPhase('out');
      timer.current = setTimeout(() => { setShown(null); setPhase(null); }, EXIT_MS);
    }
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return { shown, phase, settle: () => setPhase(p => (p === 'in' ? 'steady' : p)) };
}

function FormatOffer({ candidate }) {
  const standard = useFormatsStore(selectStandard);
  const leftPanelExpanded = useGraphStore(s => s.leftPanelExpanded);
  const rightPanelExpanded = useGraphStore(s => s.rightPanelExpanded);
  const typeListMode = useGraphStore(s => s.typeListMode);
  const mobileLandscapeShell = useMobileLandscapeShell();
  const bounds = useViewportBounds(leftPanelExpanded, rightPanelExpanded, typeListMode !== 'closed');
  const { shown, phase, settle } = useLatchedPresence(candidate);
  if (!shown) return null;

  const tokens = tokensOf(shown.chain, { standard, stack: false });
  const left = bounds.x + bounds.width / 2;
  const top = bounds.y + (mobileLandscapeShell ? 40 : 70);
  return (
    <div
      className={`format-offer is-${phase}`}
      style={{ left, top }}
      onAnimationEnd={(e) => { if (e.target === e.currentTarget) settle(); }}
    >
      <div className="format-pill format-offer-pill">
        <button
          type="button"
          className="format-offer-main"
          onClick={() => { haptic('viewportJump'); showFormatInPlace(shown); }}
          title={`Show ${shown.label} as a formula`}
        >
          <Sigma size={15} strokeWidth={2.5} />
          <span className="format-offer-preview">
            <FormulaTokens tokens={tokens} />
          </span>
        </button>
        <span className="format-offer-divider" />
        <button
          type="button"
          className="format-offer-dismiss"
          onClick={() => dismissFormatOffer(shown.key)}
          title="Not now"
          aria-label="Not now"
        >
          <X size={14} strokeWidth={2.75} />
        </button>
      </div>
    </div>
  );
}

export default function FormatsHost({ suppressed = false }) {
  const composing = useFormatsStore(s => s.composing);
  const ready = useGraphStore(s => !!s.activeGraphId && s.isUniverseLoaded && !s.isUniverseLoading && s.hasUniverseFile);
  const busy = useCanvasUIStore(s => !!s.selectedNodeIdForPieMenu || s.abstractionCarouselVisible);
  const selectedGroupId = useCanvasUIStore(s => s.selectedGroupId);

  const candidate = useFormatCandidate(ready);
  // A selected group's panel does the swapping, so the pill doesn't repeat it.
  const panelHasIt = candidate?.source === 'group' && candidate.sourceId === selectedGroupId;
  const offer = !suppressed && !busy && !composing && !panelHasIt ? candidate : null;

  return (
    <>
      <FormatOffer candidate={offer} />
      {composing && <FormulaComposer key={`${composing.at.x},${composing.at.y}`} />}
    </>
  );
}
