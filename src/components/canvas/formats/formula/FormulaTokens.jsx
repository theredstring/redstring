/**
 * A formula as a line of HTML text, token by token.
 * The offer pill and the New Formula card use it for their previews; the
 * formula on the canvas is drawn by FormulaObjectsLayer.
 */
import { memo } from 'react';

function FormulaTokens({ tokens }) {
  return (
    <span className="formula-tokens">
      {tokens.map((t) => (
        <span
          key={t.key}
          className={['formula-token', `kind-${t.kind}`, t.prefix ? 'is-prefix' : ''].filter(Boolean).join(' ')}
        >
          {t.text}
        </span>
      ))}
    </span>
  );
}

export default memo(FormulaTokens);
