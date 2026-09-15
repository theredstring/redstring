import React, { useEffect, useState } from 'react';
import { useTheme } from '../hooks/useTheme.js';
import PanelIconButton from './shared/PanelIconButton.jsx';

/**
 * The screen that holds the canvas while a universe is still arriving.
 *
 * It replaces a five-second timer that used to end the wait on the user's
 * behalf — marking the UI loaded while the read was still running, which put an
 * empty canvas and a "create something" button in front of a universe that was
 * seconds away, and then discarded the arriving universe if the invitation was
 * accepted. A timer cannot know whether a load is nearly done.
 *
 * So the wait now ends when the load ends, or when the user says to end it.
 * Two details make that bearable rather than a hang:
 *
 *   - The elapsed count only appears once waiting is worth remarking on. A
 *     fast load shows a spinner and nothing else, with no flicker of numbers.
 *   - The escape hatch appears later still, and it is a button rather than a
 *     deadline. Nothing is decided for the user, and nothing invites an edit
 *     that would be thrown away.
 */

/** Waiting is unremarkable before this; showing a clock would only add noise. */
const SHOW_ELAPSED_AFTER_MS = 2500;
/** Long enough to mean something is wrong, not so long the user feels stuck. */
const SHOW_ESCAPE_AFTER_MS = 6000;

const UniverseLoadingScreen = ({ universeName = null, onStopWaiting = null }) => {
  const theme = useTheme();
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 500);
    return () => clearInterval(timer);
  }, []);

  const stopWaiting = () => {
    if (onStopWaiting) return onStopWaiting();
    window.dispatchEvent(new CustomEvent('redstring:stop-waiting-for-universe'));
  };

  const seconds = Math.floor(elapsedMs / 1000);

  return (
    <div
      style={{
        height: '100%',
        backgroundColor: theme.canvas.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '16px',
        fontFamily: "'EmOne', sans-serif",
        color: theme.canvas.textPrimary,
        letterSpacing: '0.06em',
        fontSize: '18px',
        padding: '0 24px',
        boxSizing: 'border-box',
        textAlign: 'center'
      }}
    >
      <div
        className="loading-spinner"
        style={{
          borderColor: theme.canvas.border,
          borderTopColor: theme.canvas.textPrimary,
          width: 52,
          height: 52
        }}
      />

      <div>{universeName ? `Loading ${universeName}` : 'Preparing your universe…'}</div>

      {/*
        Reserved height, so the line appearing does not shift the spinner. The
        text swaps in; the layout does not move.
      */}
      <div style={{
        minHeight: 18,
        fontSize: 13,
        letterSpacing: '0.04em',
        color: theme.canvas.textSecondary,
        opacity: elapsedMs >= SHOW_ELAPSED_AFTER_MS ? 1 : 0,
        transition: 'opacity 0.3s ease'
      }}>
        {seconds}s
      </div>

      {elapsedMs >= SHOW_ESCAPE_AFTER_MS && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <PanelIconButton
            label="Start without it"
            labelFontSize={12}
            variant="outline"
            onClick={stopWaiting}
            style={{ padding: '6px 14px' }}
          />
          <div style={{ fontSize: 11, color: theme.canvas.textSecondary, maxWidth: 280, lineHeight: 1.4 }}>
            It will still load in the background.
          </div>
        </div>
      )}
    </div>
  );
};

export default UniverseLoadingScreen;
