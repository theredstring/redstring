import React from 'react';
import { Settings, Shield, Github } from 'lucide-react';

const STATUS_COLORS = {
  success: '#2e7d32',
  warning: '#ef6c00',
  error: '#c62828',
  info: '#1565c0'
};

function buttonStyle(variant = 'outline') {
  const base = {
    border: '1px solid #260000',
    backgroundColor: 'transparent',
    color: '#260000',
    padding: '6px 12px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    transition: 'transform 120ms ease, background-color 0.15s, color 0.15s'
  };

  switch (variant) {
    case 'solid':
      return { ...base, backgroundColor: '#260000', color: '#fefefe' };
    case 'danger':
      return { ...base, borderColor: '#c62828', color: '#c62828' };
    case 'disabled':
      return { ...base, opacity: 0.5, cursor: 'not-allowed' };
    default:
      return base;
  }
}

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
  syncStatus,
  isSlim = false
}) => {
  return (
    <div
      style={{
        backgroundColor: '#979090',
        borderRadius: 8,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Settings size={18} />
        <div style={{ fontWeight: 700 }}>Accounts & Access</div>
      </div>

      <div
        style={{
          border: `1px solid ${statusBadge.tone}`,
          borderRadius: 6,
          padding: '10px 12px',
          backgroundColor: 'rgba(255,255,255,0.35)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Shield size={14} fill={statusBadge.tone} />
          <span style={{ fontWeight: 600 }}>{statusBadge.label}</span>
        </div>
        <div style={{ fontSize: '0.75rem', color: '#260000', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div>{hasApp ? 'GitHub App ready for auto-sync' : 'Install GitHub App for auto-sync'}</div>
          <div>{hasOAuth ? 'OAuth available for browsing' : 'Connect OAuth to browse repositories'}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: isSlim ? '1fr' : '1fr 1fr' }}>
        <div
          style={{
            border: '1px solid #260000',
            borderRadius: 8,
            backgroundColor: '#bdb5b5',
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
              <span style={{ fontSize: '0.7rem', color: '#555' }}>Not connected</span>
            )}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#555' }}>Browse and manage repositories</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={onGitHubAuth}
              style={buttonStyle(isConnecting ? 'disabled' : 'solid')}
              disabled={isConnecting}
              onMouseEnter={(e) => { if (!isConnecting) e.currentTarget.style.transform = 'scale(1.04)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
            >
              <Github size={14} /> {hasOAuth ? 'Reconnect' : 'Connect'}
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: '#260000' }}>
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
            border: '1px solid #260000',
            borderRadius: 8,
            backgroundColor: '#bdb5b5',
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
              <span style={{ fontSize: '0.7rem', color: '#555' }}>Not installed</span>
            )}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#555' }}>Enables secure auto-sync with Git</div>
          <button
            onClick={onGitHubApp}
            style={buttonStyle(isConnecting ? 'disabled' : 'solid')}
            disabled={isConnecting}
            onMouseEnter={(e) => { if (!isConnecting) e.currentTarget.style.transform = 'scale(1.04)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
          >
            <Settings size={14} /> {hasApp ? 'Manage' : 'Install App'}
          </button>
        </div>
      </div>

      {/* Connection Stats moved to parent panel (GitNativeFederation) as its own section */}
    </div>
  );
};

export default AuthSection;
