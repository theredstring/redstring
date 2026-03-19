import { Settings, Shield, Github, LogOut, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import SectionCard from './shared/SectionCard.jsx';
import PanelIconButton from '../shared/PanelIconButton.jsx';

// moved STATUS_COLORS inside component


const AuthSection = ({
  statusBadge,
  hasApp,
  hasOAuth,
  dataAuthMethod,
  isConnecting,
  allowOAuthBackup,
  onSetAllowOAuthBackup,
  onGitHubAuth,
  onGitHubApp,
  activeUniverse,
  onLogout,
  requiresLogin = false,
  syncStatus,
  isSlim = false
}) => {
  const theme = useTheme();

  const STATUS_COLORS = {
    success: theme.darkMode ? '#E7E79E' : '#354702',
    warning: theme.darkMode ? '#b39ddb' : '#512da8',
    error: theme.darkMode ? '#C09191' : '#7A0000',
    info: theme.darkMode ? '#64b5f6' : '#1565c0'
  };
  // If not logged in and not loading

  return (
    <div
      data-auth-section="true"
      style={{
        backgroundColor: theme.canvas.inactive,
        borderRadius: 8,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        color: theme.canvas.textPrimary
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Settings size={18} />
        <div style={{ fontWeight: 700 }}>Accounts & Access</div>
      </div>

      <div
        style={{
          border: `1px solid ${theme.canvas.border}`,
          borderRadius: 6,
          padding: '10px 12px',
          backgroundColor: theme.canvas.bg,
          display: 'flex',
          flexDirection: 'column',
          gap: 6
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Shield size={20} fill={statusBadge.tone} color="transparent" strokeWidth={0} />
          <span style={{ fontWeight: 700, color: statusBadge.tone }}>{statusBadge.label}</span>
        </div>
        <div style={{ fontSize: '0.75rem', color: theme.canvas.textPrimary, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div>{hasApp ? 'GitHub App ready for auto-sync' : 'Install GitHub App for auto-sync'}</div>
          <div>{hasOAuth ? 'OAuth available for browsing' : 'Connect OAuth to browse repositories'}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: isSlim ? '1fr' : '1fr 1fr' }}>
        <div
          style={{
            border: `1px solid ${theme.canvas.border}`,
            borderRadius: 8,
            backgroundColor: theme.canvas.bg,

            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 600 }}>GitHub OAuth</div>
            {hasOAuth ? (
              <span style={{ fontSize: '0.7rem', color: STATUS_COLORS.success, fontWeight: 700 }}>Connected</span>
            ) : (
               <span style={{ fontSize: '0.7rem', color: STATUS_COLORS.error, fontWeight: 700 }}>Not connected</span>
            )}
          </div>
          <div style={{ fontSize: '0.75rem', color: theme.canvas.textSecondary }}>Browse and manage repositories</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <PanelIconButton
              icon={Github}
              onClick={onGitHubAuth}
              label={hasOAuth ? 'Reconnect' : 'Connect'}
              variant={isConnecting ? 'disabled' : 'solid'}
              disabled={isConnecting}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: theme.canvas.textPrimary }}>
              <input 
                type="checkbox" 
                checked={allowOAuthBackup} 
                onChange={(e) => onSetAllowOAuthBackup(e.target.checked)} 
              />
              Allow OAuth as backup
            </label>
          </div>
        </div>

        <div
          style={{
            border: `1px solid ${theme.canvas.border}`,
            borderRadius: 8,
            backgroundColor: theme.canvas.bg,

            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 600 }}>GitHub App</div>
            {hasApp ? (
              <span style={{ fontSize: '0.7rem', color: STATUS_COLORS.success, fontWeight: 700 }}>Installed</span>
            ) : (
               <span style={{ fontSize: '0.7rem', color: STATUS_COLORS.error, fontWeight: 700 }}>Not installed</span>
            )}
          </div>
          <div style={{ fontSize: '0.75rem', color: theme.canvas.textSecondary }}>Enables secure auto-sync with Git</div>
          <PanelIconButton
            icon={Settings}
            onClick={onGitHubApp}
            label={hasApp ? 'Manage' : 'Install App'}
            variant={isConnecting ? 'disabled' : 'solid'}
            disabled={isConnecting}
          />
        </div>
      </div>

      {/* Connection Stats moved to parent panel (UniverseManager) as its own section */}
    </div>
  );
};

export default AuthSection;
