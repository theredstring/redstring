/**
 * A formula as a line of HTML text, token by token, exponents raised and
 * divisions stacked as fractions when the tokens say so (tokensOf with `standard`). The offer pill, the panel chip and the
 * New Formula card use it; the formula on the canvas is drawn by
 * FormulaObjectsLayer, with the same proportions.
 */
import { memo, useMemo } from 'react';
import { subscriptOf, rowsOf } from './formulaChain.js';

const RAISE_SCALE = 0.7;
const RAISE_STEP = 0.5;      // in the size it is lifted from
const RAISE_GAP_IN = -0.05;  // in the line's em: drawn in against its base
const RAISE_GAP_OUT = 0.18;
const SUBSCRIPT_SCALE = 0.62; // a logarithm's base, as formulaObjects lowers it
const SUBSCRIPT_DROP = 0.28;  // in the size it is lowered from

/** Size, lift and the gap before a token, in the token's own em. */
function tokenStyle(level, prevLevel, sub) {
  const levelScale = Math.pow(RAISE_SCALE, level);
  const scale = sub ? levelScale * SUBSCRIPT_SCALE : levelScale;
  let lift = 0;
  for (let i = 0; i < level; i++) lift += RAISE_STEP * Math.pow(RAISE_SCALE, i);
  if (sub) lift -= SUBSCRIPT_DROP * levelScale;
  const gap = level > prevLevel ? RAISE_GAP_IN : level < prevLevel ? RAISE_GAP_OUT : 0;
  if (!level && !gap && !sub) return undefined;
  return {
    ...(level || sub ? { fontSize: `${scale}em`, top: `${-lift / scale}em` } : {}),
    ...(gap ? { marginLeft: `${gap / scale}em` } : {}),
  };
}

const classOf = (t) => ['formula-token', `kind-${t.kind}`, t.prefix ? 'is-prefix' : '', t.joined ? 'is-joined' : '',
  t.sub ? 'is-lowered' : '', t.subNext ? 'is-before-lowered' : ''].filter(Boolean).join(' ');

/** One row of tokens and fractions (rowsOf), exponents raised against the token before them. */
function Row({ row, tokens, highlight, highlightStyle }) {
  let prevLevel = 0;
  return row.map((entry) => {
    if (typeof entry !== 'number') {
      prevLevel = 0;
      const bar = entry.bar !== null ? tokens[entry.bar] : null;
      return (
        <span key={bar?.key || entry.id} className="formula-frac">
          <span className="formula-frac-num"><Row row={entry.num} tokens={tokens} highlight={highlight} highlightStyle={highlightStyle} /></span>
          <span className="formula-frac-bar" />
          <span className="formula-frac-den"><Row row={entry.den} tokens={tokens} highlight={highlight} highlightStyle={highlightStyle} /></span>
        </span>
      );
    }
    const t = tokens[entry];
    const style = tokenStyle(t.level || 0, prevLevel, t.sub);
    prevLevel = t.level || 0;
    const sub = subscriptOf(t.text);
    return (
      <span
        key={t.key}
        className={classOf(t)}
        style={highlight && t.protoId === highlight ? { ...style, ...highlightStyle, borderRadius: '0.3em', opacity: 1 } : style}
      >
        {sub ? <>{sub[0]}<sub className="formula-token-sub">{sub[1]}</sub></> : t.text}
      </span>
    );
  });
}

/** `highlight`: a Thing whose tokens are lit, with `highlightStyle`. */
function FormulaTokens({ tokens, highlight = null, highlightStyle = null }) {
  const rows = useMemo(() => rowsOf(tokens), [tokens]);
  return (
    <span className="formula-tokens">
      <Row row={rows} tokens={tokens} highlight={highlight} highlightStyle={highlightStyle} />
    </span>
  );
}

export default memo(FormulaTokens);
