import React from 'react';
import './PlanCard.css';

/**
 * PlanCard - Live-updating plan checklist that renders inline in the wizard chat.
 * Matches the visual language of MultipleChoiceOverlay (sharp corners, EmOne font,
 * maroon accents, slideUpFade entrance).
 *
 * Supports nested substeps under each step. Substeps are visible when the parent
 * step is in_progress or done, collapsed when pending.
 */
export default function PlanCard({ steps, frozen = false }) {
  if (!steps || steps.length === 0) return null;

  const done = steps.filter(s => s.status === 'done').length;
  const total = steps.length;
  const isComplete = done === total;

  const className = [
    'plan-card',
    isComplete ? 'plan-card--complete' : '',
    frozen ? 'plan-card--frozen' : ''
  ].filter(Boolean).join(' ');

  return (
    <div className={className}>
      <div className="plan-card-header">
        <span className="plan-card-icon">✦</span>
        <span className="plan-card-title">Plan</span>
        <span className="plan-card-separator">·</span>
        <span className="plan-card-progress">{done} of {total}</span>
      </div>
      <div className="plan-card-steps">
        {steps.map((step, i) => (
          <div key={i} className="plan-card-step-group">
            <div className={`plan-card-step plan-card-step--${step.status}`}>
              <span className="plan-card-step-icon">
                {step.status === 'done' ? '✓' : step.status === 'in_progress' ? '▸' : '○'}
              </span>
              <span className="plan-card-step-text">{step.description}</span>
            </div>
            {!frozen && step.substeps && step.substeps.length > 0 && (step.status === 'in_progress' || step.status === 'done') && (
              <div className="plan-card-substeps">
                {step.substeps.map((sub, j) => (
                  <div
                    key={j}
                    className={`plan-card-substep plan-card-substep--${sub.status}`}
                  >
                    <span className="plan-card-substep-icon">
                      {sub.status === 'done' ? '✓' : sub.status === 'in_progress' ? '▸' : '○'}
                    </span>
                    <span className="plan-card-substep-text">{sub.description}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
