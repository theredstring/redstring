/**
 * Which formats a group can be swapped between (the group control panel's
 * format mode; see FormatPanelPreview).
 */
import useGraphStore from '../../../store/graphStore.js';
import { readGroupFormula } from './formatCandidates.js';
import { chainText } from './formula/formulaChain.js';

/** The group's formula as text, or null when it doesn't read as one. A string, so it only changes when the formula does. */
export function useGroupFormulaText(groupId) {
  return useGraphStore((s) => {
    if (!groupId) return null;
    const chain = readGroupFormula(s, s.activeGraphId, groupId);
    return chain ? chainText(chain) : null;
  });
}

/** The formats a group can be swapped between, in ◀ ▶ order. */
export function groupFormats(formulaText) {
  return formulaText ? ['things', 'formula'] : ['things'];
}

export const FORMAT_LABELS = { things: 'Things', formula: 'Formula' };

