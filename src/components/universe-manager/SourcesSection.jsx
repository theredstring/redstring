import React from 'react';
import { Github } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import SectionCard from './shared/SectionCard.jsx';

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
    case 'danger':
      return { ...base, borderColor: '#c62828', color: '#c62828' };
    case 'disabled':
      return { ...base, opacity: 0.5, cursor: 'not-allowed' };
    default:
      return base;
  }
}

/**
 * SourcesSection - Displays external GitHub repository sources
 * These are repos that aren't Redstring-specific but are used across universes
 */
const SourcesSection = ({
  sources = [],
  discoveryMap = {},
  onDiscover,
  onDetach,
  onLinkDiscovered
}) => {
  const theme = useTheme();
  const githubSources = sources.filter((src) => src.type === 'github');

  if (githubSources.length === 0) {
    return (
      <SectionCard title="External Sources" subtitle="GitHub repositories used across universes">
          <div
            style={{
              padding: 12,
              border: `1px dashed ${theme.canvas.border}`,
              borderRadius: 6,
              backgroundColor: theme.canvas.bg,
              color: theme.canvas.textSecondary,
              fontSize: '0.8rem'
            }}
          >
          No external sources linked. External sources allow you to reference data from repositories outside your own GitHub account.
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="External Sources"
      subtitle={`${githubSources.length} external ${githubSources.length === 1 ? 'repository' : 'repositories'} linked`}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {githubSources.map((source) => {
          const key = `${source.user}/${source.repo}`;
          const discovery = discoveryMap[key] || {};

          return (
            <div
              key={source.id}
              style={{
                border: `1px solid ${theme.canvas.border}`,
                borderRadius: 8,
                padding: 12,
                backgroundColor: theme.canvas.bg,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                color: theme.canvas.textPrimary
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Github size={18} />
                  <div>
                    <div style={{ fontWeight: 600, color: theme.canvas.textPrimary }}>@{source.user}/{source.repo}</div>
                    <div style={{ fontSize: '0.72rem', color: theme.canvas.textSecondary }}>
                      Linked {new Date(source.addedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => onDiscover(source)}
                    style={buttonStyle(theme, discovery.loading ? 'disabled' : 'outline')}
                    disabled={discovery.loading}
                    onMouseEnter={(e) => { if (!discovery.loading) e.currentTarget.style.transform = 'scale(1.04)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                  >
                    {discovery.loading ? 'Scanning…' : 'Discover universes'}
                  </button>
                  <button
                    onClick={() => onDetach(source)}
                    style={buttonStyle(theme, 'danger')}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.04)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    Remove
                  </button>
                </div>
              </div>

              {discovery.error && (
                <div style={{ fontSize: '0.72rem', color: '#d32f2f' }}>{discovery.error}</div>
              )}

              {discovery.items && discovery.items.length > 0 && (
                <div
                  style={{
                    border: `1px solid ${theme.canvas.border}`,
                    borderRadius: 6,
                    backgroundColor: theme.canvas.inactive,
                    maxHeight: 160,
                    overflowY: 'auto',
                    padding: 6
                  }}
                >
                  {discovery.items.map((item) => (
                    <div
                      key={`${key}:${item.slug || item.path}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: 6,
                        borderBottom: `1px solid ${theme.canvas.border}`,
                        gap: 8
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.78rem' }}>{item.name || item.slug || 'Universe'}</div>
                          <div style={{ fontSize: '0.68rem', color: theme.canvas.textSecondary }}>{item.path || item.location || 'Unknown path'}</div>
                      </div>
                      <button
                        onClick={() => onLinkDiscovered(item, { user: source.user, repo: source.repo })}
                        style={buttonStyle(theme, 'solid')}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.04)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                      >
                        Link
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
};

export default SourcesSection;
