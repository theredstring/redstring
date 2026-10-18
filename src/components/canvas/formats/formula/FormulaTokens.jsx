/**
 * A formula as a line of HTML text, token by token, exponents raised when the
 * tokens say so (tokensOf with `raised`). The offer pill, the panel chip and the
 * New Formula card use it; the formula on the canvas is drawn by
 * FormulaObjectsLayer, with the same proportions.
 */
import { memo } from 'react';

const RAISE_SCALE = 0.62;
const RAISE_STEP = 0.5;      // in the size it is lifted from
const RAISE_GAP_IN = 0.08;   // in the line's em
const RAISE_GAP_OUT = 0.18;

/** Size, lift and the gap before a token, in the token's own em. */
function tokenStyle(level, prevLevel) {
  const scale = Math.pow(RAISE_SCALE, level);
  let lift = 0;
  for (let i = 0; i < level; i++) lift += RAISE_STEP * Math.pow(RAISE_SCALE, i);
  const gap = level > prevLevel ? RAISE_GAP_IN : level < prevLevel ? RAISE_GAP_OUT : 0;
  if (!level && !gap) return undefined;
  return {
    ...(level ? { fontSize: `${scale}em`, top: `${-lift / scale}em` } : {}),
    ...(gap ? { marginLeft: `${gap / scale}em` } : {}),
  };
}

function FormulaTokens({ tokens }) {
  return (
    <span className="formula-tokens">
      {tokens.map((t, i) => (
        <span
          key={t.key}
          className={['formula-token', `kind-${t.kind}`, t.prefix ? 'is-prefix' : '', t.joined ? 'is-joined' : ''].filter(Boolean).join(' ')}
          style={tokenStyle(t.level || 0, i > 0 ? (tokens[i - 1].level || 0) : 0)}
        >
          {t.text}
        </span>
      ))}
    </span>
  );
}

export default memo(FormulaTokens);
