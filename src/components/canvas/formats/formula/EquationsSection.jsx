/**
 * The panel's Equations section for a Thing: how it is written in formulas
 * (its formula label: Pressure as P), and every equation it is part of, each
 * as "P in Ideal Gas Law" with the formula underneath, its own token lit.
 * Shown once the Thing is in an equation or has a label.
 */
import { useEffect, useState } from 'react';
import useGraphStore from '../../../../store/graphStore.js';
import { useTheme } from '../../../../hooks/useTheme.js';
import { getTextColor } from '../../../../utils/colorUtils.js';
import { NODE_DEFAULT_COLOR } from '../../../../constants.js';
import CollapsibleSection from '../../../CollapsibleSection.jsx';
import StandardDivider from '../../../StandardDivider.jsx';
import FormulaTokens from './FormulaTokens.jsx';
import { equationsOf } from './formulaEquations.js';
import { subscriptOf } from './formulaChain.js';
import '../formats.css';

function SymbolText({ text }) {
  const sub = subscriptOf(text);
  return sub ? <>{sub[0]}<sub className="formula-token-sub">{sub[1]}</sub></> : text;
}

/** How the Thing is written in formulas. Empty means by its name. */
function WrittenAs({ proto }) {
  const theme = useTheme();
  const saved = proto.labels?.formula || '';
  const [draft, setDraft] = useState(saved);
  useEffect(() => { setDraft(saved); }, [saved]);
  const commit = () => {
    const next = draft.trim();
    if (next === saved) return;
    useGraphStore.getState().updateNodePrototype(proto.id, (p) => {
      const labels = { ...(p.labels || {}) };
      if (next) labels.formula = next; else delete labels.formula;
      if (Object.keys(labels).length) p.labels = labels; else delete p.labels;
    });
  };
  return (
    <label className="equations-written-as" style={{ color: theme.canvas.textSecondary }}>
      Written as
      <input
        value={draft}
        placeholder={proto.name}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(saved); e.currentTarget.blur(); }
        }}
        style={{ color: theme.canvas.textPrimary, borderColor: theme.canvas.textPrimary }}
      />
    </label>
  );
}

export default function EquationsSection({ protoId, onOpenNode }) {
  const theme = useTheme();
  const proto = useGraphStore((s) => (protoId ? s.nodePrototypes.get(protoId) : null));
  const rows = useGraphStore((s) => equationsOf(s, protoId));
  if (!proto || (!rows.length && !proto.labels?.formula)) return null;
  const color = proto.color || NODE_DEFAULT_COLOR;
  const lit = { backgroundColor: color, color: getTextColor(color, theme.darkMode) };
  return (
    <>
      <StandardDivider margin="20px 0" />
      <CollapsibleSection title="Equations" count={rows.length} defaultExpanded>
        <div className="equations-section" style={{ color: theme.canvas.textPrimary }}>
          <WrittenAs proto={proto} />
          {rows.map((row) => (
            <button
              key={row.key}
              type="button"
              className="equations-row"
              onClick={() => row.equationProtoId && onOpenNode?.(row.equationProtoId)}
              disabled={!row.equationProtoId}
              style={{ color: theme.canvas.textPrimary, borderColor: theme.canvas.textPrimary }}
            >
              <span className="equations-row-title">
                <span className="equations-row-symbol" style={lit}><SymbolText text={row.symbol} /></span>
                {' in '}
                {row.title || 'Untitled'}
              </span>
              <span className="equations-row-formula">
                <FormulaTokens tokens={row.tokens} highlight={protoId} highlightStyle={lit} />
              </span>
            </button>
          ))}
        </div>
      </CollapsibleSection>
    </>
  );
}
