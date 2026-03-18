import React from 'react';

import {
  Github,
  ExternalLink,
  RefreshCw,
  Trash2,
  Star,
  GitBranch,
  AlertCircle
} from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import SectionCard from './shared/SectionCard.jsx';
import PanelIconButton from '../shared/PanelIconButton.jsx';

function buttonStyle(theme, variant = 'outline') {
  const base = {
    border: `1px solid ${theme.canvas.border}`,
    backgroundColor: 'transparent',
    color: theme.canvas.textPrimary,
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
      return { ...base, backgroundColor: theme.canvas.textPrimary, color: theme.canvas.bg };
    case 'disabled':
      return { ...base, opacity: 0.5, cursor: 'not-allowed' };
    default:
      return base;
  }
}

/**
 * RepositoriesSection - Shows your managed repositories
 * Add repos from GitHub that you want to use with Redstring
 */
const RepositoriesSection = ({
  repositories = [],
  discoveryMap = {},
  onBrowseRepositories,
  onRemoveRepository,
  onSetMainRepository,
  onDiscoverRepository,
  onImportUniverse,
  onSyncUniverse
}) => {
  const theme = useTheme();
  if (repositories.length === 0) {
    return (
      <SectionCard 
        title="Repositories" 
        subtitle="Your curated list of repositories"
        actions={
          <button 
            onClick={onBrowseRepositories} 
            style={buttonStyle(theme, 'solid')}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.04)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
          >
            <Github size={14} /> Add Repositories
          </button>
        }
      >
        <div
          style={{
            padding: 16,
            border: `1px dashed ${theme.canvas.border}`,
            borderRadius: 8,
            backgroundColor: theme.canvas.bg,
            textAlign: 'center',
            color: theme.canvas.textSecondary,
            fontSize: '0.8rem'
          }}
        >
          No repositories in your list. Click "Add Repositories" to browse your GitHub repos and add them here.
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard 
      title="Repositories" 
      subtitle={`${repositories.length} ${repositories.length === 1 ? 'repository' : 'repositories'} in your list`}
      actions={
        <button 
          onClick={onBrowseRepositories} 
          style={buttonStyle(theme, 'solid')}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.04)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
        >
          <Github size={14} /> Add More
        </button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {repositories.map((repo) => {
          const repoFullName = `${repo.owner?.login || repo.owner}/${repo.name}`;
          const discoveryKey = repoFullName;
          const discoveryState = discoveryMap?.[discoveryKey] || {};
          const discoveredItems = discoveryState.items || [];
          const isDiscovering = Boolean(discoveryState.loading);

          return (
            <div
              key={repo.id || repoFullName}
              style={{
                border: `1px solid ${repo.disabled ? theme.canvas.border : theme.canvas.border}`,
                borderRadius: 8,
                padding: 12,
                backgroundColor: repo.disabled ? theme.canvas.disabledBg : theme.canvas.bg,
                opacity: repo.disabled ? 0.6 : 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                color: theme.canvas.textPrimary
              }}
            >
              {/* Repository header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                  <Github size={18} />
                  <div>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {repoFullName}
                      {repo.isMain && (
                        <Star size={14} style={{ color: '#cc6600', fill: '#cc6600' }} title="Main repository" />
                      )}
                    </div>
                    {repo.description && (
                      <div style={{ fontSize: '0.72rem', color: theme.canvas.textSecondary }}>{repo.description}</div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  {repo.html_url && (
                      <a
                        href={repo.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          ...buttonStyle(theme, 'outline'),
                          textDecoration: 'none'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.04)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                      >
                        <ExternalLink size={14} />
                      </a>
                  )}
                </div>
              </div>

              {/* Action buttons row */}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {onSetMainRepository && (
                  <PanelIconButton
                    icon={Star}
                    size={20}
                    filled={repo.isMain}
                    fillColor="#cc6600"
                    color={repo.isMain ? theme.canvas.brand : theme.canvas.textPrimary}
                    hoverColor={repo.isMain ? theme.canvas.brand : theme.canvas.textPrimary}
                    onClick={() => onSetMainRepository(repo)}
                    title={repo.isMain ? 'Already main repository' : 'Set as main repository'}
                    disabled={repo.isMain}
                  />
                )}

                {onRemoveRepository && (
                  <PanelIconButton
                    icon={Trash2}
                    size={20}
                    onClick={() => onRemoveRepository(repo)}
                    title="Remove from list"
                  />
                )}
              </div>

              {/* Discovered universes */}
              <div
                style={{
                  marginTop: 10,
                borderTop: `1px solid ${theme.canvas.border}`,
                  paddingTop: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <GitBranch size={14} />
                    <span style={{ fontWeight: 600, fontSize: '0.75rem' }}>Universe files</span>
                    {discoveryState.error && (
                      <span style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        color: theme.canvas.brand,
                        fontSize: '0.7rem'
                      }}>
                        <AlertCircle size={12} />
                        {discoveryState.error}
                      </span>
                    )}
                  </div>
                  <PanelIconButton
                    icon={RefreshCw}
                    size={20}
                    onClick={() => {
                      if (!onDiscoverRepository) return;
                      const user = repo.owner?.login || repo.owner;
                      onDiscoverRepository({ user, repo: repo.name });
                    }}
                    title={discoveredItems.length > 0 ? 'Rescan for universe files' : 'Scan for universe files'}
                    disabled={isDiscovering}
                    style={{
                      animation: isDiscovering ? 'spin 1s linear infinite' : 'none'
                    }}
                  />
                </div>

                {isDiscovering ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: '#555' }}>
                    <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
                    Discovering universes...
                  </div>
                ) : discoveredItems.length === 0 ? (
                  <div style={{ fontSize: '0.72rem', color: '#555', fontStyle: 'italic' }}>
                    No universes discovered yet. Run a scan to locate .redstring files.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {discoveredItems.map((item, idx) => {
                      const displayName = item.name || item.slug || item.fileName || `Universe ${idx + 1}`;
                      const itemPath = item.path || item.location || item.universeFile;
                      const repoInfo = {
                        user: repo.owner?.login || repo.owner,
                        repo: repo.name
                      };

                      return (
                          <div
                            key={`${displayName}-${itemPath || idx}`}
                            style={{
                              border: `1px solid ${theme.canvas.border}`,
                              borderRadius: 6,
                              backgroundColor: theme.canvas.inactive,
                              padding: 10,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6
                            }}
                          >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600, fontSize: '0.78rem', color: theme.canvas.textPrimary }}>{displayName}</div>
                              {itemPath && (
                                <div style={{ fontSize: '0.68rem', color: '#555' }}>{itemPath}</div>
                              )}
                              <div style={{ fontSize: '0.65rem', color: theme.canvas.brand, display: 'flex', gap: 10, marginTop: 4 }}>
                                {item.nodeCount !== undefined && (
                                  <span>{item.nodeCount} nodes</span>
                                )}
                                {item.connectionCount !== undefined && (
                                  <span>{item.connectionCount} connections</span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {onImportUniverse && (
                              <button
                                onClick={() => onImportUniverse(item, repoInfo)}
                                style={{
                                  ...buttonStyle(theme, 'outline'),
                                  borderColor: theme.canvas.border,
                                  color: theme.canvas.textSecondary,
                                  fontSize: '0.7rem',
                                  padding: '4px 8px'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.04)'}
                                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                              >
                                Import Copy
                              </button>
                            )}
                                <button
                                  onClick={() => onAttach(item, repo)}
                                  style={{
                                    ...buttonStyle(theme, 'outline'),
                                    fontSize: '0.7rem',
                                    padding: '4px 8px'
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'scale(1.04)';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'scale(1)';
                                  }}
                                >
                                  Attach to Universe
                                </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <style>
        {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
    </SectionCard>
  );
};

export default RepositoriesSection;
