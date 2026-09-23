import AuthSection from '../universe-manager/AuthSection.jsx';
import GitHubDeviceFlowPanel from '../modals/GitHubDeviceFlowPanel.jsx';
import { useTheme } from '../../hooks/useTheme.js';
import { getStatusColors } from '../../utils/statusColors.js';
import { isGitHubDeviceFlowShowing } from '../../hooks/useGitHubConnection.js';

/**
 * The OAuth + App cards and their notice line, driven by useGitHubConnection.
 * Shared by the onboarding wizard's connect step and the reconnect modal.
 *
 * On native shells the device flow embeds here in place of the cards, rather
 * than as a stacked modal that would render behind the host modal's overlay.
 * Hosts that want to retitle themselves during the device flow can check
 * `isGitHubDeviceFlowShowing(connection)`.
 */
const GitHubConnectPanel = ({ connection, compact = false }) => {
  const theme = useTheme();
  const statusColors = getStatusColors(theme.darkMode);
  const {
    deviceFlowState, cancelDeviceFlow, authNotice,
    statusBadge, hasApp, hasOAuth, oauthAccount, appAccount, oauthVerification, appNeedsOAuth,
    isConnecting, allowOAuthBackup, setAllowOAuthBackup,
    connectOAuth, disconnectOAuth, connectApp, disconnectApp, detectApp
  } = connection;

  return (
    <>
      {isGitHubDeviceFlowShowing(connection) ? (
        <GitHubDeviceFlowPanel
          compact
          onCancel={cancelDeviceFlow}
          title={deviceFlowState.title || 'Connect to GitHub'}
          subtitle={deviceFlowState.subtitle}
          userCode={deviceFlowState.userCode}
          verificationUri={deviceFlowState.verificationUri}
          verificationUriComplete={deviceFlowState.verificationUriComplete}
          expiresAt={deviceFlowState.expiresAt}
          status={deviceFlowState.status}
          errorMessage={deviceFlowState.errorMessage}
        />
      ) : (
        <AuthSection
          statusBadge={statusBadge}
          hasApp={hasApp}
          hasOAuth={hasOAuth}
          oauthAccount={oauthAccount}
          appAccount={appAccount}
          dataAuthMethod={hasOAuth ? 'oauth' : (hasApp ? 'github-app' : null)}
          isConnecting={isConnecting}
          allowOAuthBackup={allowOAuthBackup}
          onSetAllowOAuthBackup={setAllowOAuthBackup}
          onGitHubAuth={connectOAuth}
          onGitHubDisconnect={disconnectOAuth}
          onGitHubApp={connectApp}
          onGitHubAppDisconnect={disconnectApp}
          onGitHubAppDetect={detectApp}
          oauthVerification={oauthVerification}
          appNeedsOAuth={appNeedsOAuth}
          isSlim={compact}
          minimal
        />
      )}

      {authNotice && (
        <div style={{
          marginTop: '12px',
          padding: '8px 12px',
          borderRadius: '6px',
          fontSize: '0.8rem',
          fontFamily: "'EmOne', sans-serif",
          border: `1px solid ${theme.canvas.border}`,
          color: authNotice.type === 'error' ? statusColors.error : theme.canvas.textPrimary,
          backgroundColor: theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA'
        }}>
          {authNotice.message}
        </div>
      )}
    </>
  );
};

export default GitHubConnectPanel;
