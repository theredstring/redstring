import React from 'react';
import { Cable, X } from 'lucide-react';
import { getTextColor } from '../../../utils/colorUtils';
import { useTheme } from '../../../hooks/useTheme.js';
import { sanitizeColor } from '../../../utils/safeColor.js';
import PanelIconButton from '../../shared/PanelIconButton.jsx';
import { identifiedSources, listWords } from '../../../services/conceptLinking.js';

/**
 * Which Thing a Discover search started from, and where it stands.
 *
 * A search from a node is a question about that node: which of these is it.
 * The bar names the node in its own colour so the results read as answers to
 * that question, and the line beneath says whether it has been answered.
 * `linkedConcepts` are the results on screen that are it. Results from
 * different sources add up on one Thing, so there can be several.
 */
const SearchOriginBar = ({ origin, linkedConcepts = [], onClear, style }) => {
  const theme = useTheme();
  if (!origin) return null;
  const color = sanitizeColor(origin.color, theme.accent.primary);
  const small = { fontSize: '11px', lineHeight: 1.4, color: theme.canvas.textSecondary, fontFamily: "'EmOne', sans-serif" };
  const cable = <Cable size={11} style={{ verticalAlign: '-1px' }} />;

  const sources = identifiedSources(origin);
  const linkedNames = [...new Set(linkedConcepts.map(c => c.name))];

  let status;
  if (linkedNames.length > 0) {
    status = (
      <>
        Identified on {listWords(sources)}: <strong style={{ color: theme.canvas.textPrimary }}>{listWords(linkedNames)}</strong>. Adding it or its connections uses {origin.name}.
        {sources.length < 3 && <> Other sources add with {cable}.</>}
      </>
    );
  } else if (sources.length > 0) {
    status = <>Already identified as another result on {listWords(sources)}. Replace or add with {cable}.</>;
  } else {
    status = <>Not identified yet. Use {cable} on a result that is this same Thing.</>;
  }

  return (
    <div style={{ marginBottom: '12px', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <span style={{ ...small, fontWeight: 'bold', color: theme.canvas.textPrimary }}>From</span>
        <span
          title={origin.name}
          style={{
            background: color,
            color: getTextColor(color, theme.darkMode),
            borderRadius: '10px',
            padding: '4px 10px',
            fontSize: '12px',
            fontWeight: 'bold',
            fontFamily: "'EmOne', sans-serif",
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {origin.name}
        </span>
        {onClear && (
          <PanelIconButton
            icon={X}
            size={12}
            onClick={onClear}
            title={`Stop linking results to ${origin.name}`}
            style={{ flexShrink: 0 }}
          />
        )}
      </div>
      <div style={small}>{status}</div>
    </div>
  );
};

export default SearchOriginBar;
