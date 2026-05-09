import React from 'react';
import { Sparkles } from 'lucide-react';
import '../ToolCallCard.css';

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

  const actionTitle =
    action === 'refine-connections' ? 'Refine connection' :
    action === 'define-node' ? 'Define components' :
    'Ask The Wizard';

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
