/**
 * Universe Browser Component
 * Discovers and displays available universes in connected repositories
 * Enables easy linking and switching between universes
 */

import React, { useState, useEffect } from 'react';
import { universeBackend } from '../backend/universes/index.js';

const UniverseBrowser = ({ isOpen, onClose, onUniverseLinked }) => {
  const [repositories, setRepositories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [linking, setLinking] = useState(null);

  // Load available repository universes when component opens
  useEffect(() => {
    if (isOpen) {
      loadRepositoryUniverses();
    }
  }, [isOpen]);

  const loadRepositoryUniverses = async () => {
    setLoading(true);
    setError(null);

    try {
      const available = await universeBackend.getAvailableRepositoryUniverses();
      setRepositories(available);
    } catch (err) {
      console.error('[UniverseBrowser] Failed to load repository universes:', err);
      setError(`Failed to load repository universes: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLinkUniverse = async (discoveredUniverse, repoConfig) => {
    setLinking(discoveredUniverse.slug);
    setError(null);

    try {
      const universeSlug = await universeBackend.linkToDiscoveredUniverse(discoveredUniverse, repoConfig);

      // Notify parent component
      if (onUniverseLinked) {
        onUniverseLinked(universeSlug, discoveredUniverse);
      }

      // Refresh the list
      await loadRepositoryUniverses();

    } catch (err) {
      console.error('[UniverseBrowser] Failed to link universe:', err);
      setError(`Failed to link to universe: ${err.message}`);
    } finally {
      setLinking(null);
    }
  };

  const formatStats = (stats) => {
    const parts = [];
    if (stats.nodes > 0) parts.push(`${stats.nodes} nodes`);
    if (stats.graphs > 0) parts.push(`${stats.graphs} graphs`);
    if (stats.edges > 0) parts.push(`${stats.edges} edges`);
    return parts.join(', ') || 'Empty';
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown';
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return 'Unknown';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="universe-browser-overlay">
      <div className="universe-browser-modal">
        <div className="universe-browser-header">
          <h2>Repository Universes</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="universe-browser-content">
          {loading && (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>Scanning repositories for universes...</p>
            </div>
          )}

          {error && (
            <div className="error-state">
              <p className="error-message">{error}</p>
              <button onClick={loadRepositoryUniverses} className="retry-button">
                Retry
              </button>
            </div>
          )}

          {!loading && !error && repositories.length === 0 && (
            <div className="empty-state">
              <p>No repositories with Git connections found.</p>
              <p>Connect to a repository to discover universes.</p>
            </div>
          )}

          {!loading && repositories.length > 0 && (
            <div className="repositories-list">
              {repositories.map((repo, repoIndex) => (
                <div key={repoIndex} className="repository-section">
                  <div className="repository-header">
                    <h3>{repo.repository}</h3>
                    <span className="universe-count">
                      {repo.universes.length} universe{repo.universes.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {repo.universes.length === 0 ? (
                    <div className="no-universes">
                      <p>No universes found in this repository</p>
                    </div>
                  ) : (
                    <div className="universes-grid">
                      {repo.universes.map((universe, universeIndex) => (
                        <div key={universeIndex} className="universe-card">
                          <div className="universe-info">
                            <h4 className="universe-name">{universe.name}</h4>
                            <p className="universe-path">{universe.path}</p>

                            <div className="universe-stats">
                              <span className="stats">{formatStats(universe.stats)}</span>
                              <span className="format">{universe.format.version || 'unknown'}</span>
                            </div>

                            {universe.metadata.description && (
                              <p className="universe-description">
                                {universe.metadata.description}
                              </p>
                            )}

                            <div className="universe-meta">
                              {universe.metadata.modified && (
                                <span className="modified">
                                  Modified: {formatDate(universe.metadata.modified)}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="universe-actions">
                            <button
                              className="link-button"
                              onClick={() => {
                                // Parse repository string "user/repo" into config object
                                const [user, repoName] = repo.repository.split('/');
                                const repoConfig = { user, repo: repoName, type: 'github', authMethod: 'oauth' };
                                handleLinkUniverse(universe, repoConfig);
                              }}
                              disabled={linking === universe.slug}
                            >
                              {linking === universe.slug ? 'Linking...' : 'Link to Universe'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="universe-browser-footer">
          <button onClick={loadRepositoryUniverses} disabled={loading}>
            Refresh
          </button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>

      <style jsx>{`
        .universe-browser-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 10000;
        }

        .universe-browser-modal {
          background: white;
          border-radius: 8px;
          width: 90vw;
          max-width: 1000px;
          max-height: 80vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }

        .universe-browser-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 20px;
          border-bottom: 1px solid #eee;
        }

        .universe-browser-header h2 {
          margin: 0;
          color: #333;
        }

        .close-button {
          background: none;
          border: none;
          font-size: 24px;
          cursor: pointer;
          color: #666;
          padding: 0;
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .close-button:hover {
          color: #333;
        }

        .universe-browser-content {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
        }

        .loading-state, .error-state, .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px;
          text-align: center;
        }

        .spinner {
          width: 40px;
          height: 40px;
          border: 4px solid #f3f3f3;
          border-top: 4px solid #007bff;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 16px;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .error-message {
          color: #dc3545;
          margin-bottom: 16px;
        }

        .retry-button {
          background: #007bff;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
        }

        .retry-button:hover {
          background: #0056b3;
        }

        .repository-section {
          margin-bottom: 32px;
        }

        .repository-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          padding-bottom: 8px;
          border-bottom: 2px solid #007bff;
        }

        .repository-header h3 {
          margin: 0;
          color: #007bff;
        }

        .universe-count {
          font-size: 14px;
          color: #666;
          background: #f8f9fa;
          padding: 4px 8px;
          border-radius: 12px;
        }

        .no-universes {
          text-align: center;
          padding: 20px;
          color: #666;
          font-style: italic;
        }

        .universes-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
          gap: 16px;
        }

        .universe-card {
          border: 1px solid #ddd;
          border-radius: 8px;
          overflow: hidden;
          transition: box-shadow 0.2s;
        }

        .universe-card:hover {
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .universe-info {
          padding: 16px;
        }

        .universe-name {
          margin: 0 0 8px 0;
          color: #333;
          font-size: 16px;
        }

        .universe-path {
          margin: 0 0 12px 0;
          font-size: 12px;
          color: #666;
          font-family: monospace;
          background: #f8f9fa;
          padding: 4px 8px;
          border-radius: 4px;
        }

        .universe-stats {
          display: flex;
          justify-content: space-between;
          margin-bottom: 12px;
          font-size: 14px;
        }

        .stats {
          color: #007bff;
          font-weight: 500;
        }

        .format {
          color: #666;
          font-size: 12px;
        }

        .universe-description {
          margin: 0 0 12px 0;
          font-size: 14px;
          color: #555;
          line-height: 1.4;
        }

        .universe-meta {
          font-size: 12px;
          color: #999;
        }

        .universe-actions {
          padding: 12px 16px;
          background: #f8f9fa;
          border-top: 1px solid #eee;
        }

        .link-button {
          background: #28a745;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          width: 100%;
        }

        .link-button:hover:not(:disabled) {
          background: #218838;
        }

        .link-button:disabled {
          background: #6c757d;
          cursor: not-allowed;
        }

        .universe-browser-footer {
          display: flex;
          justify-content: space-between;
          padding: 16px 20px;
          border-top: 1px solid #eee;
          gap: 12px;
        }

        .universe-browser-footer button {
          padding: 8px 16px;
          border: 1px solid #ddd;
          border-radius: 4px;
          background: #f8f9fa;
          cursor: pointer;
        }

        .universe-browser-footer button:hover {
          background: #e9ecef;
        }

        .universe-browser-footer button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
};

export default UniverseBrowser;