/**
 * The group control panel's format mode (UnifiedBottomControlPanel mode
 * "format"): what tells the panel a group reads as a formula, and the formula
 * it shows while the group is shown as one, written as the canvas writes it
 * (its text, no chip), always by its symbols, whatever the canvas has written
 * by name. ◀ ▶ in the panel swap formats.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import useGraphStore from '../../../store/graphStore.js';
import { readGroupFormula } from './formatCandidates.js';
import { tokensOf } from './formula/formulaChain.js';
import { useGroupFormulaText } from './groupFormats.js';
import useFormatsStore, { selectStandard } from './formatsStore.js';
import FormulaTokens from './formula/FormulaTokens.jsx';

/**
 * Too long for the panel, a formula ends at the last whole token that fits
 * (not an operation), then "…", so the box is exactly as wide as what it
 * shows (a token is one piece, which the browser's own ellipsis can't cut,
 * leaving a gap after it).
 */
function useFitTokens(boxRef, tokens) {
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const fit = () => {
      const line = box.querySelector('.formula-tokens');
      const more = box.querySelector('.format-panel-more');
      if (!line || !more) return;
      const parts = [...line.children];
      parts.forEach((part) => { part.style.display = ''; });
      more.style.display = 'none';
      if (box.scrollWidth <= box.clientWidth + 0.5) return;
      more.style.display = '';
      let last = parts.length - 1;
      for (; last > 0 && box.scrollWidth > box.clientWidth + 0.5; last--) parts[last].style.display = 'none';
      // Not ending on an operation (Volume × …): on what it joins.
      for (; last > 0 && parts[last].classList.contains('kind-operator'); last--) parts[last].style.display = 'none';
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, [boxRef, tokens]);
}

export default function FormatPanelPreview({ groupId }) {
  const formulaText = useGroupFormulaText(groupId);
  const standard = useFormatsStore(selectStandard);
  const tokens = useMemo(() => {
    if (!formulaText) return null;
    const chain = readGroupFormula(useGraphStore.getState(), useGraphStore.getState().activeGraphId, groupId);
    return chain ? tokensOf(chain, { standard, stack: false }) : null;
  }, [formulaText, groupId, standard]);
  const boxRef = useRef(null);
  useFitTokens(boxRef, tokens);
  if (!tokens) return null;
  return (
    <div ref={boxRef} className="format-panel-formula">
      <FormulaTokens tokens={tokens} />
      <span className="format-panel-more" style={{ display: 'none' }}>…</span>
    </div>
  );
}
