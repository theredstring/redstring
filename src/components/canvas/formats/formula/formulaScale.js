/**
 * A formula's smaller text, in the size of what it is drawn against: one set,
 * so the canvas (formulaObjects) and the HTML line (FormulaTokens) keep the
 * same proportions.
 */
export const RAISE_SCALE = 0.78;    // a raised token's size, per level (and a sum's limits)
export const RAISE_STEP = 0.5;      // how far each level lifts, in the size it is lifted from
export const RAISE_GAP_IN = -0.05;  // before an exponent, in the line's em: drawn in against its base
export const RAISE_GAP_OUT = 0.18;  // and after it, so what follows doesn't crowd it
export const SUBSCRIPT_SCALE = 0.72; // a subscript, or a logarithm's base
export const SUBSCRIPT_DROP = 0.28; // em of the token, below its baseline
