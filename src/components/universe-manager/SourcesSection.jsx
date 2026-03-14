import React from 'react';
import { Github } from 'lucide-react';
import SectionCard from './shared/SectionCard.jsx';

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
    transition: 'all 0.15s'
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
  const githubSources = sources.filter((src) => src.type === 'github');

  if (githubSources.length === 0) {
    return (
      <SectionCard title="External Sources" subtitle="GitHub repositories used across universes">
        <div
          style={{
            padding: 12,
            border: '1px dashed #979090',
            borderRadius: 6,
            backgroundColor: '#bdb5b5',
            color: '#555',
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
                border: '1px solid #260000',
                borderRadius: 8,
                padding: 12,
                backgroundColor: '#bdb5b5',
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Github size={18} />
                  <div>
                    <div style={{ fontWeight: 600 }}>@{source.user}/{source.repo}</div>
                    <div style={{ fontSize: '0.72rem', color: '#555' }}>
                      Linked {new Date(source.addedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button 
                    onClick={() => onDiscover(source)}
                    style={buttonStyle(discovery.loading ? 'disabled' : 'outline')}
                    disabled={discovery.loading}
                  >
                    {discovery.loading ? 'Scanning…' : 'Discover universes'}
                  </button>
                  <button 
                    onClick={() => onDetach(source)}
                    style={buttonStyle('danger')}
                  >
                    Remove
                  </button>
                </div>
              </div>

              {discovery.error && (
                <div style={{ fontSize: '0.72rem', color: '#7A0000' }}>{discovery.error}</div>
              )}

              {discovery.items && discovery.items.length > 0 && (
                <div
                  style={{
                    border: '1px solid #979090',
                    borderRadius: 6,
                    backgroundColor: '#cfc6c6',
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
                        borderBottom: '1px solid #979090',
                        gap: 8
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.78rem' }}>{item.name || item.slug || 'Universe'}</div>
                        <div style={{ fontSize: '0.68rem', color: '#555' }}>{item.path || item.location || 'Unknown path'}</div>
                      </div>
                      <button
                        onClick={() => onLinkDiscovered(item, { user: source.user, repo: source.repo })}
                        style={buttonStyle('solid')}
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
