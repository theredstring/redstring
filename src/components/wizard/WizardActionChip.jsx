import React from 'react';
import { Sparkles } from 'lucide-react';
import '../ToolCallCard.css';
import { INTENTS } from '../../wizard/prompts/intents.js';

/** action → what the chip says it did. Keyed by the registry so the two agree. */
export const CHIP_TITLES = {
  'refine-connections': 'Refine connection',
  'define-node': 'Define components',
  'refine-abstraction': 'Build abstraction chain',
  'grow-graph': 'Grow this Web',
  'connect-thing': 'Check for connections',
  'fill-details': 'Fill in details',
  'explain-thing': 'Explain this Thing',
  'explain-connection': 'Explain this Connection',
  'connection-gaps': 'Check for missing connections',
  'summarize-web': 'Summarize this Web',
  'audit-web': 'Audit this Web',
  ...Object.fromEntries(
    INTENTS.filter(i => i.tier === 'freetext').map(i => [i.action, 'Ask something specific'])
  )
};

/**
 * Compact, right-aligned card representing a programmatic Ask The Wizard action
 * (e.g., refine a connection or define a node's components). Visually identical
 * to the AI's tool-call cards on the wizard side — same CSS classes and layout —
 * just rendered on the user side. No expand/dropdown; the rich prompt is sent to
 * the model but never shown to the user.
 */
const WizardActionChip = ({ message }) => {
  const md = message?.metadata || {};
  const action = md.action || 'wizard-action';
  const label = md.label || message?.content || '';

  // Driven by the intent registry rather than a hardcoded list, so an added ask
  // does not silently render as the generic fallback. The registry's own labels
  // are second person ("Explain this Thing"); these are what the chip shows in a
  // transcript, which reads better in the third.
  const actionTitle = CHIP_TITLES[action] || 'Ask The Wizard';

  return (
    <div className="tool-call-card" style={{ width: 'fit-content', maxWidth: '100%', minWidth: 200 }}>
      <div className="tool-call-header" style={{ cursor: 'default' }}>
        <div className="tool-icon"><Sparkles size={18} /></div>
        <div className="tool-header-content">
          <div className="tool-header-row">
            <span className="tool-name">Ask The Wizard</span>
          </div>
          <div className="tool-call-summary">
            {actionTitle}{label ? ` · ${label}` : ''}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WizardActionChip;
