/**
 * A formula as a line of HTML text, token by token, exponents raised,
 * divisions stacked as fractions and roots drawn over what they hold when the
 * tokens say so (tokensOf with `standard`). The offer pill, the panel chip and the
 * New Formula card use it; the formula on the canvas is drawn by
 * FormulaObjectsLayer, with the same proportions.
 */
import { memo, useMemo } from 'react';
import { subscriptOf, rowsOf, vectorOf } from './formulaChain.js';
import { RAISE_SCALE, RAISE_STEP, RAISE_GAP_IN, RAISE_GAP_OUT, SUBSCRIPT_SCALE, SUBSCRIPT_DROP } from './formulaScale.js';

/** Size, lift and the gap before a token, in the token's own em (a sum's limits small, unlifted). */
function tokenStyle(level, prevLevel, sub, script) {
  const levelScale = Math.pow(RAISE_SCALE, level);
  const scale = (sub ? levelScale * SUBSCRIPT_SCALE : levelScale) * (script ? RAISE_SCALE : 1);
  let lift = 0;
  for (let i = 0; i < level; i++) lift += RAISE_STEP * Math.pow(RAISE_SCALE, i);
  if (sub) lift -= SUBSCRIPT_DROP * levelScale;
  const gap = level > prevLevel ? RAISE_GAP_IN : level < prevLevel ? RAISE_GAP_OUT : 0;
  if (!level && !gap && !sub && !script) return undefined;
  if (script && !level && !sub) return { fontSize: `${scale}em`, ...(gap ? { marginLeft: `${gap / scale}em` } : {}) };
  return {
    ...(level || sub ? { fontSize: `${scale}em`, top: `${-lift / scale}em` } : {}),
    ...(gap ? { marginLeft: `${gap / scale}em` } : {}),
    // Raised, it sits against its base.
    ...(level > prevLevel ? { paddingLeft: '0.02em' } : {}),
  };
}

const classOf = (t) => ['formula-token', `kind-${t.kind}`, t.prefix ? 'is-prefix' : '', t.joined ? 'is-joined' : '',
  t.sub ? 'is-lowered' : '', t.subNext ? 'is-before-lowered' : ''].filter(Boolean).join(' ');

/** One row of tokens and fractions (rowsOf), exponents raised against the token before them. */
function Row({ row, tokens, highlight, highlightStyle }) {
  let prevLevel = 0;
  const rowOf = (r) => <Row row={r} tokens={tokens} highlight={highlight} highlightStyle={highlightStyle} />;
  return row.map((entry) => {
    if (typeof entry !== 'number' && entry.kind === 'big') {
      const sign = tokens[entry.sign];
      prevLevel = sign.level || 0;
      // ∑ and lim over what they run over; ∫ with its limits at its side.
      return (
        <span key={sign.key} className={`formula-big ${entry.scripts ? 'is-scripts' : 'is-limits'}${sign.kind === 'function' ? ' is-word' : ''}`}>
          {entry.scripts ? (
            <>
              <span className="formula-big-sign">{sign.text}</span>
              <span className="formula-big-scripts">
                <span className="formula-big-over">{rowOf(entry.over)}</span>
                <span className="formula-big-under">{rowOf(entry.under)}</span>
              </span>
            </>
          ) : (
            <>
              <span className="formula-big-over">{rowOf(entry.over)}</span>
              <span className="formula-big-sign">{sign.text}</span>
              <span className="formula-big-under">{rowOf(entry.under)}</span>
            </>
          )}
        </span>
      );
    }
    if (typeof entry !== 'number' && entry.kind === 'root') {
      prevLevel = tokens[entry.sign].level || 0;
      // The sign stretches to the height of what it holds; the bar is the body's
      // top edge. Unsized itself: what it holds carries its own size and lift.
      return (
        <span key={tokens[entry.sign].key} className="formula-root">
          <svg className="formula-root-sign" viewBox="0 0 10 20" preserveAspectRatio="none" aria-hidden="true">
            <polyline points="0.5,11.6 2.2,10 5,19.5 10,0.4" vectorEffect="non-scaling-stroke" />
          </svg>
          <span className="formula-root-body"><Row row={entry.body} tokens={tokens} highlight={highlight} highlightStyle={highlightStyle} /></span>
        </span>
      );
    }
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
    const style = tokenStyle(t.level || 0, prevLevel, t.sub, t.script);
    prevLevel = t.level || 0;
    const sub = subscriptOf(t.text);
    const { letter, vector } = vectorOf(sub ? sub[0] : t.text);
    const shown = vector ? <span className="formula-vec">{letter}</span> : letter;
    return (
      <span
        key={t.key}
        className={classOf(t)}
        style={highlight && t.protoId === highlight ? { ...style, ...highlightStyle, borderRadius: '0.3em', opacity: 1 } : style}
      >
        {sub ? <>{shown}<sub className="formula-token-sub">{sub[1]}</sub></> : shown}
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
