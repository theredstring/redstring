import React from 'react';
import { RefreshCw } from 'lucide-react';
import PanelIconButton from './PanelIconButton.jsx';
import useGraphStore from '../../store/graphStore.js';
import { useTheme } from '../../hooks/useTheme.js';
import { HEADER_HEIGHT } from '../../constants';

/**
 * Crash containment. A component that throws while rendering unmounts
 * everything up to the nearest error boundary, and with none the whole app
 * goes blank (a Thing with no name in TypeList's sort did exactly that). Each
 * region of the shell sits in its own boundary, so a failure there shows
 * "Try again" in that region and the rest of the app keeps working.
 *
 * A region boundary also clears itself when the active web changes: moving
 * away from the data that broke it is the usual way out.
 *
 * Every catch is logged as `[crash] <region>` with the component stack, so it
 * reaches the Electron terminal and the device log.
 */
class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, resetKey: props.resetKey };
    this.retry = () => this.setState({ error: null });
  }

  static getDerivedStateFromError(error) {
    return { error: error || new Error('Unknown render error') };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey === state.resetKey) return null;
    return { resetKey: props.resetKey, error: null };
  }

  componentDidCatch(error, info) {
    console.error(`[crash] ${this.props.region}:`, error?.message || error, '\n', error?.stack || '', '\n', info?.componentStack || '');
  }

  render() {
    if (this.state.error) return this.props.renderFallback({ error: this.state.error, retry: this.retry });
    return this.props.children;
  }
}

const LABELS = {
  header: 'The header',
  'left-panel': 'This panel',
  'right-panel': 'This panel',
  canvas: 'The canvas',
  'type-list': 'The types bar',
};

function RegionFallback({ region, variant, error, retry }) {
  const theme = useTheme();
  const label = LABELS[region] || 'Something on screen';
  const button = (
    <PanelIconButton
      icon={RefreshCw}
      size={14}
      label="Try again"
      labelFontSize={14}
      variant="outline"
      color={theme.canvas.textSecondary}
      onClick={retry}
      style={{ pointerEvents: 'auto' }}
    />
  );
  const title = <span style={{ fontFamily: "'EmOne', sans-serif", color: theme.canvas.textPrimary }}>{label} hit an error</span>;
  const detail = error?.message
    ? <span style={{ fontSize: 12, color: theme.canvas.textSecondary, maxWidth: 320, overflowWrap: 'anywhere' }}>{error.message}</span>
    : null;

  if (variant === 'bar') {
    return (
      <div style={{ height: HEADER_HEIGHT, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '0 12px', backgroundColor: theme.canvas.bg }}>
        {title}
        {button}
      </div>
    );
  }
  if (variant === 'overlay') {
    return (
      <div style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 20000, display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 10, backgroundColor: theme.canvas.bg, boxShadow: '0 2px 10px rgba(0,0,0,0.25)' }}>
        {title}
        {button}
      </div>
    );
  }
  return (
    <div style={{
      flex: 1,
      height: '100%',
      minWidth: variant === 'panel' ? 260 : 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      padding: 20,
      boxSizing: 'border-box',
      textAlign: 'center',
      backgroundColor: theme.canvas.bg,
    }}>
      {title}
      {detail}
      {button}
    </div>
  );
}

/**
 * One region of the shell. `variant`: 'fill' (the canvas), 'panel' (a side
 * panel), 'bar' (header, types bar) or 'overlay' (modals and floating hosts).
 */
export function RegionBoundary({ region, variant = 'fill', children }) {
  const activeGraphId = useGraphStore((s) => s.activeGraphId);
  return (
    <Boundary
      region={region}
      resetKey={activeGraphId}
      renderFallback={({ error, retry }) => <RegionFallback region={region} variant={variant} error={error} retry={retry} />}
    >
      {children}
    </Boundary>
  );
}

// The last line: around the whole app, outside the stores, so its fallback
// can't depend on whatever broke. Never a blank screen.
const appFallbackStyle = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  padding: 24,
  textAlign: 'center',
  backgroundColor: '#2e2e2e',
  color: '#bdb5b5',
  fontFamily: "'EmOne', sans-serif",
};
const appButtonStyle = {
  padding: '8px 16px',
  borderRadius: 8,
  border: '1px solid #bdb5b5',
  background: 'none',
  color: '#bdb5b5',
  fontSize: 14,
  fontFamily: 'inherit',
  cursor: 'pointer',
};

export function AppBoundary({ children }) {
  return (
    <Boundary
      region="app"
      renderFallback={({ error, retry }) => (
        <div style={appFallbackStyle}>
          <div style={{ fontSize: 22 }}>Redstring hit an error</div>
          {error?.message ? <div style={{ fontSize: 12, opacity: 0.75, maxWidth: 420, overflowWrap: 'anywhere' }}>{error.message}</div> : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={appButtonStyle} onClick={retry}>Try again</button>
            <button type="button" style={appButtonStyle} onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      )}
    >
      {children}
    </Boundary>
  );
}
