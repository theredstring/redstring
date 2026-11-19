import { ArrowRight } from 'lucide-react';
import GitHubConnectPanel from './GitHubConnectPanel.jsx';
import PanelIconButton from './PanelIconButton.jsx';
import { useTheme } from '../../hooks/useTheme.js';
import { isGitHubDeviceFlowShowing } from '../../hooks/useGitHubConnection.js';

/**
 * Connect GitHub: the one place Redstring links GitHub, OAuth and the App.
 * Onboarding shows it as a step; everything else that needs GitHub before it
 * can go on shows it as GitHubConnectModal. Driven by useGitHubConnection.
 *
 * `onContinue`, when given, is the Continue button, live once both are
 * connected. Hosts that move on by themselves once connected leave it out.
 * `allowOAuthOnly` offers going on without the App (onboarding's create flow).
 */
const GitHubConnectStep = ({ connection, compact = false, onContinue = null, allowOAuthOnly = false }) => {
  const theme = useTheme();
  const { hasOAuth, hasApp, deviceFlowState } = connection;
  const deviceFlowShowing = isGitHubDeviceFlowShowing(connection);
  const connected = hasOAuth && hasApp;
  const hint = {
    marginTop: '8px',
    textAlign: 'center',
    fontSize: '0.78rem',
    lineHeight: 1.35,
    color: theme.canvas.textSecondary,
    fontFamily: "'EmOne', sans-serif"
  };

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: deviceFlowShowing ? '10px' : '16px', flexShrink: 0 }}>
        <h2 style={{
          margin: deviceFlowShowing ? 0 : '0 0 8px 0',
          color: theme.canvas.textPrimary,
          fontSize: compact ? '1.2rem' : '1.5rem',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif"
        }}>
          {deviceFlowShowing ? (deviceFlowState.title || 'Connect GitHub') : 'Connect GitHub'}
        </h2>
        {!deviceFlowShowing && (
          <p style={{ color: theme.canvas.textPrimary, opacity: 0.8, margin: 0, lineHeight: 1.4, fontSize: compact ? '0.8rem' : '0.9rem' }}>
            Redstring uses GitHub OAuth to browse your repositories and the GitHub App to sync your universes.
          </p>
        )}
      </div>

      <GitHubConnectPanel connection={connection} compact={compact} />

      {!deviceFlowShowing && (
        <div style={{ marginTop: '16px' }}>
          {onContinue && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <PanelIconButton
                label="Continue"
                icon={ArrowRight}
                size={16}
                labelFontSize={13}
                labelPosition="left"
                variant="solid"
                onClick={onContinue}
                disabled={!connected}
              />
            </div>
          )}
          {!connected && (
            <div style={hint}>
              {!hasOAuth
                ? 'Connect GitHub OAuth to continue.'
                : 'Install the GitHub App for auto-sync. It will be detected automatically.'}
            </div>
          )}
          {onContinue && allowOAuthOnly && hasOAuth && !hasApp && (
            <button
              onClick={onContinue}
              style={{
                display: 'block',
                margin: '10px auto 0',
                background: 'none',
                border: 'none',
                color: theme.canvas.textSecondary,
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: '0.78rem',
                fontFamily: "'EmOne', sans-serif"
              }}
            >
              Continue with OAuth only
            </button>
          )}
        </div>
      )}
    </>
  );
};

export default GitHubConnectStep;
