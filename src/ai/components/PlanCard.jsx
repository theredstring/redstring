import React from 'react';
import './PlanCard.css';

/**
 * PlanCard - Live-updating plan checklist that renders inline in the wizard chat.
 * Matches the visual language of MultipleChoiceOverlay (sharp corners, EmOne font,
 * maroon accents, slideUpFade entrance).
 *
 * Updates in-place when the wizard calls planTask again — the parent replaces
 * the steps prop rather than creating a new card.
 */
export default function PlanCard({ steps }) {
  if (!steps || steps.length === 0) return null;

  const done = steps.filter(s => s.status === 'done').length;
  const total = steps.length;

  return (
    <div className="plan-card">
      <div className="plan-card-header">
        <span className="plan-card-icon">✦</span>
        <span className="plan-card-title">Plan</span>
        <span className="plan-card-separator">·</span>
        <span className="plan-card-progress">{done} of {total}</span>
      </div>
      <div className="plan-card-steps">
        {steps.map((step, i) => (
          <div
            className={`plan-card-step plan-card-step--${step.status}`}
            key={i}
          >
            <span className="plan-card-step-icon">
              {step.status === 'done' ? '✓' : step.status === 'in_progress' ? '▸' : '○'}
            </span>
            <span className="plan-card-step-text">{step.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
