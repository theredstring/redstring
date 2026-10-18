/**
 * A formula as a line of HTML text, token by token, with exponents raised.
 * The offer pill and the New Formula card use it for their previews; the
 * formula on the canvas is drawn by FormulaObjectsLayer.
 */
import { memo } from 'react';

const RAISE_SCALE = 0.62;
const RAISE_STEP = 0.48; // in the base size's em

/** Vertical offset (in the token's own em) and size for a raised token. */
function raiseStyle(level) {
  if (!level) return undefined;
  let offset = 0;
  for (let i = 0; i < level; i++) offset += RAISE_STEP * Math.pow(RAISE_SCALE, i);
  const scale = Math.pow(RAISE_SCALE, level);
  return { fontSize: `${scale}em`, top: `${-(offset / scale)}em` };
}

function FormulaTokens({ tokens }) {
  return (
    <span className="formula-tokens">
      {tokens.map((t) => (
        <span
          key={t.key}
          className={['formula-token', `kind-${t.kind}`, t.raise ? 'is-raise' : '', t.prefix ? 'is-prefix' : ''].filter(Boolean).join(' ')}
          style={raiseStyle(t.level)}
        >
          {t.text}
        </span>
      ))}
    </span>
  );
}

export default memo(FormulaTokens);
