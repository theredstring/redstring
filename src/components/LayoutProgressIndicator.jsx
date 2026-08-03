import React from 'react';
import { NODE_DEFAULT_COLOR } from '../constants';

/**
 * Progress indicator for an in-flight auto-layout solve.
 *
 * The solver runs in a worker (see layout.worker.js), so the main thread is
 * free and this genuinely animates — which is the whole reason it can exist.
 * On the old synchronous path any indicator would have frozen on its first
 * painted frame and read as a crash.
 *
 * Deliberately non-modal: no backdrop, no pointer capture. The canvas stays
 * pannable and zoomable while the layout computes, so this reports rather than
 * interrupts. It sits above the bottom control panel, out of the graph's way.
 *
 * @param {{progress: number, nodeCount: number, estimatedMs: number}|null} state
 * @param {() => void} onCancel
 */
const LayoutProgressIndicator = ({ state, onCancel }) => {
  if (!state) return null;

  const pct = Math.round(Math.min(1, Math.max(0, state.progress || 0)) * 100);

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 150,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 16px',
        borderRadius: 10,
        backgroundColor: '#260000',
        color: '#bdb5b5',
        fontFamily: "'EmOne', sans-serif",
        fontSize: 13,
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        // Reports progress; never blocks the canvas underneath. Only the
        // cancel button opts back into pointer events.
        pointerEvents: 'none',
        userSelect: 'none'
      }}
      role="status"
      aria-live="polite"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 190 }}>
        <span>
          Laying out {state.nodeCount} nodes… {pct}%
        </span>
        <div
          style={{
            width: '100%',
            height: 4,
            borderRadius: 2,
            backgroundColor: 'rgba(189,181,181,0.25)',
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              backgroundColor: NODE_DEFAULT_COLOR,
              // Progress arrives in ~50 discrete steps; the transition keeps
              // the bar reading as continuous motion between them.
              transition: 'width 120ms linear'
            }}
          />
        </div>
      </div>

      <button
        onClick={onCancel}
        style={{
          pointerEvents: 'auto',
          cursor: 'pointer',
          background: 'transparent',
          border: '1px solid rgba(189,181,181,0.4)',
          borderRadius: 6,
          color: '#bdb5b5',
          fontFamily: 'inherit',
          fontSize: 12,
          padding: '5px 10px'
        }}
      >
        Cancel
      </button>
    </div>
  );
};

export default LayoutProgressIndicator;
