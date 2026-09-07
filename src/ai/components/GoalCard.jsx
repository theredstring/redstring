import React from 'react';
import './PlanCard.css';
import './GoalCard.css';

/**
 * GoalCard - The Goal Based mode's inline card: what the Wizard is after, what
 * would count as reaching it, what would count as failing, and — once judged —
 * the verdict. Borrows PlanCard's chrome so the two read as siblings.
 *
 * @param {Object} props.goal  { goal, satisfiedWhen, failsIf, status, verdict }
 */
export default function GoalCard({ goal, frozen = false }) {
  if (!goal || !goal.goal) return null;

  const status = goal.status === 'satisfied' || goal.status === 'failed' ? goal.status : 'open';
  const fails = Array.isArray(goal.failsIf) ? goal.failsIf.filter(Boolean) : [];

  const className = [
    'plan-card',
    'goal-card',
    `goal-card--${status}`,
    status === 'satisfied' ? 'plan-card--complete' : '',
    frozen ? 'plan-card--frozen' : ''
  ].filter(Boolean).join(' ');

  const statusText = status === 'satisfied' ? 'satisfied' : status === 'failed' ? 'failed' : 'open';

  return (
    <div className={className}>
      <div className="plan-card-header">
        <span className="plan-card-icon">◎</span>
        <span className="plan-card-title">Goal</span>
        <span className="plan-card-separator">·</span>
        <span className="plan-card-progress">{statusText}</span>
      </div>
      <div className="goal-card-body">
        <div className="goal-card-goal">{goal.goal}</div>
        <div className="goal-card-row">
          <span className="goal-card-label">Satisfied when</span>
          <span className="goal-card-text">{goal.satisfiedWhen}</span>
        </div>
        {fails.length > 0 && (
          <div className="goal-card-row">
            <span className="goal-card-label">Fails if</span>
            <ul className="goal-card-fails">
              {fails.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          </div>
        )}
        {status !== 'open' && goal.verdict && (
          <div className="goal-card-row goal-card-verdict">
            <span className="goal-card-label">Verdict</span>
            <span className="goal-card-text">{goal.verdict}</span>
          </div>
        )}
      </div>
    </div>
  );
}
