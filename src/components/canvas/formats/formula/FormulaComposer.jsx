/**
 * "New Formula" (the canvas menu): a small card where the offer pill sits.
 * Type a formula, see it read back token by token, and Add builds it as Things
 * at the spot that was right-clicked (buildFormula.js), shown as its formula.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import useGraphStore from '../../../../store/graphStore.js';
import { useViewportBounds } from '../../../../hooks/useViewportBounds';
import { useMobileLandscapeShell } from '../../../../hooks/useMobileLandscapeShell.js';
import { linearize, parseFormulaText } from './formulaNotation.js';
import { buildFormulaInWeb } from './buildFormula.js';
import FormulaTokens from './FormulaTokens.jsx';
import useFormatsStore, { closeFormulaComposer } from '../formatsStore.js';

const withIds = (tree) => {
  let n = 0;
  const tag = (node) => ({ ...node, id: `draft-${n++}`, ...(node.children ? { children: node.children.map(tag) } : {}) });
  return tag(tree);
};

export default function FormulaComposer() {
  const composing = useFormatsStore(s => s.composing);
  const leftPanelExpanded = useGraphStore(s => s.leftPanelExpanded);
  const rightPanelExpanded = useGraphStore(s => s.rightPanelExpanded);
  const typeListMode = useGraphStore(s => s.typeListMode);
  const mobileLandscapeShell = useMobileLandscapeShell();
  const bounds = useViewportBounds(leftPanelExpanded, rightPanelExpanded, typeListMode !== 'closed');
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { requestAnimationFrame(() => inputRef.current?.focus()); }, []);

  const parsed = useMemo(() => {
    if (!draft.trim()) return { tree: null, error: null };
    try { return { tree: withIds(parseFormulaText(draft)), error: null }; } catch (err) { return { tree: null, error: err.message }; }
  }, [draft]);
  const line = useMemo(() => (parsed.tree ? linearize(parsed.tree) : null), [parsed.tree]);

  const add = () => {
    if (!composing || !parsed.tree) return;
    buildFormulaInWeb(draft, composing.graphId, composing.at);
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
          placeholder="E = m * c^2"
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="formula-composer-add" disabled={!parsed.tree}>Add</button>
        <button type="button" className="format-offer-dismiss" onClick={closeFormulaComposer} aria-label="Cancel">
          <X size={14} strokeWidth={2.75} />
        </button>
      </form>
      <div className="formula-composer-preview">
        {line ? (
          <FormulaTokens tokens={line.tokens} />
        ) : parsed.error}
      </div>
    </div>
  );
}
