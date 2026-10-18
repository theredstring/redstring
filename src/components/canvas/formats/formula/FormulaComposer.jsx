/**
 * "New Formula" (the canvas menu): an entry pill where the offer pill sits,
 * with how to read what's typed (Math or Programming) on a slider pill under
 * it, and the reading itself, token by token, under that. Enter, or the send arrow,
 * builds it as Things at the spot that was right-clicked (buildFormula.js),
 * shown as its formula.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { SendHorizontal, X } from 'lucide-react';
import useGraphStore from '../../../../store/graphStore.js';
import { useViewportBounds } from '../../../../hooks/useViewportBounds';
import { useMobileLandscapeShell } from '../../../../hooks/useMobileLandscapeShell.js';
import { chainFromText, tokensOf } from './formulaChain.js';
import { buildFormulaInWeb } from './buildFormula.js';
import FormulaTokens from './FormulaTokens.jsx';
import useFormatsStore, { closeFormulaComposer, setConvention, selectStandard } from '../formatsStore.js';

const CONVENTION_OPTIONS = [
  { key: 'math', label: 'Math' },
  { key: 'programming', label: 'Programming' },
];

const PLACEHOLDER = { math: 'E = mc^2', programming: 'energy = mass * c**2' };

/** The names this universe already has: math reads them whole ("mc" if a Thing is called mc). */
function knownNamesNow() {
  const names = new Set();
  for (const p of useGraphStore.getState().nodePrototypes.values()) {
    if (!p.isOrbitCatalog && p.name) names.add(String(p.name).trim());
  }
  return names;
}

function ConventionSlider({ value, onChange }) {
  const index = Math.max(0, CONVENTION_OPTIONS.findIndex(o => o.key === value));
  return (
    <div className="format-slider" role="radiogroup" aria-label="Read as">
      <span
        className="format-slider-thumb"
        style={{ width: `calc((100% - 6px) / ${CONVENTION_OPTIONS.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {CONVENTION_OPTIONS.map(o => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={o.key === value}
          className={`format-slider-option${o.key === value ? ' is-active' : ''}`}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function FormulaComposer() {
  const composing = useFormatsStore(s => s.composing);
  const convention = useFormatsStore(s => s.convention);
  const standard = useFormatsStore(selectStandard);
  const leftPanelExpanded = useGraphStore(s => s.leftPanelExpanded);
  const rightPanelExpanded = useGraphStore(s => s.rightPanelExpanded);
  const typeListMode = useGraphStore(s => s.typeListMode);
  const mobileLandscapeShell = useMobileLandscapeShell();
  const bounds = useViewportBounds(leftPanelExpanded, rightPanelExpanded, typeListMode !== 'closed');
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);
  const knownNames = useMemo(knownNamesNow, []);

  useEffect(() => { requestAnimationFrame(() => inputRef.current?.focus()); }, []);

  const readOptions = useMemo(() => ({ convention, isKnownName: (n) => knownNames.has(n) }), [convention, knownNames]);
  const parsed = useMemo(() => {
    if (!draft.trim()) return { chain: null, error: null };
    try { return { chain: chainFromText(draft, readOptions), error: null }; } catch (err) { return { chain: null, error: err.message }; }
  }, [draft, readOptions]);
  const tokens = useMemo(() => (parsed.chain ? tokensOf(parsed.chain, { standard }) : null), [parsed.chain, standard]);

  const add = () => {
    if (!composing || !parsed.chain) return;
    buildFormulaInWeb(draft, composing.graphId, composing.at, readOptions);
    closeFormulaComposer();
  };

  return (
    <div
      className="formula-composer"
      style={{ left: bounds.x + bounds.width / 2, top: bounds.y + (mobileLandscapeShell ? 40 : 70) }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); closeFormulaComposer(); } }}
    >
      <form className="format-pill formula-composer-card" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={PLACEHOLDER[convention]}
          spellCheck={false}
          autoComplete="off"
          enterKeyHint="done"
        />
        <button type="submit" className="formula-composer-add" disabled={!parsed.chain} title="Add to Web" aria-label="Add to Web">
          <SendHorizontal size={16} strokeWidth={2.5} />
        </button>
        <span className="format-offer-divider" />
        <button type="button" className="format-offer-dismiss" onClick={closeFormulaComposer} title="Cancel" aria-label="Cancel">
          <X size={14} strokeWidth={2.75} />
        </button>
      </form>
      <ConventionSlider
        value={convention}
        onChange={(next) => { setConvention(next); inputRef.current?.focus(); }}
      />
      <div className="formula-composer-preview">
        {tokens ? <FormulaTokens tokens={tokens} /> : parsed.error}
      </div>
    </div>
  );
}
