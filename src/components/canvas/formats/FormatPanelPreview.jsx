/**
 * The group control panel's format mode (UnifiedBottomControlPanel mode
 * "format"): what tells the panel a group reads as a formula, and the chip it
 * shows while the group is shown as one. ◀ ▶ in the panel swap formats.
 */
import { useMemo } from 'react';
import { Sigma } from 'lucide-react';
import useGraphStore from '../../../store/graphStore.js';
import { getTextColor } from '../../../utils/colorUtils.js';
import { NODE_DEFAULT_COLOR } from '../../../constants.js';
import { readGroupFormula } from './formatCandidates.js';
import { tokensOf, expandFor } from './formula/formulaChain.js';
import { useGroupFormulaText } from './groupFormats.js';
import useFormatsStore, { selectStandard } from './formatsStore.js';
import FormulaTokens from './formula/FormulaTokens.jsx';

export default function FormatPanelPreview({ groupId, color, darkMode }) {
  const formulaText = useGroupFormulaText(groupId);
  const standard = useFormatsStore(selectStandard);
  const names = useFormatsStore(s => s.namesShown.has(groupId));
  const flipped = useFormatsStore(s => s.flipped.get(groupId));
  const tokens = useMemo(() => {
    if (!formulaText) return null;
    const chain = readGroupFormula(useGraphStore.getState(), useGraphStore.getState().activeGraphId, groupId);
    return chain ? tokensOf(chain, { standard, stack: false, expand: expandFor(names, flipped) }) : null;
  }, [formulaText, groupId, standard, names, flipped]);
  if (!tokens) return null;
  const fill = color || NODE_DEFAULT_COLOR;
  return (
    <div className="format-panel-chip" style={{ backgroundColor: fill, color: getTextColor(fill, darkMode) }}>
      <Sigma size={18} strokeWidth={2.75} />
      <FormulaTokens tokens={tokens} />
    </div>
  );
}
