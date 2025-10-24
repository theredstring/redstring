/**
 * Repository Manager Component
 * Manages repository collections for users and organizations
 * Handles OAuth integration and repository CRUD operations
 */

import React, { useState, useEffect } from 'react';
import { Users, Plus, Settings, RefreshCw, ChevronDown, Github } from 'lucide-react';
import RepositoryList from './RepositoryList.jsx';
import { oauthFetch } from '../../services/bridgeConfig.js';
import { persistentAuth } from '../../services/persistentAuth.js';

const RepositoryManager = ({
  onSelectRepository,
  currentUser,
  showCreateOption = true,
  dropdownMode = false, // New prop for dropdown mode
  onAddToList, // NEW: Function to add repo to managed list
  managedRepositories = [] // NEW: Array of already-managed repos
}) => {
  const [repositories, setRepositories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [authStatus, setAuthStatus] = useState(persistentAuth.getAuthStatus());

  // Load repositories on mount and when auth status changes
  useEffect(() => {
    if (authStatus.hasOAuthTokens) {
      loadRepositories();
    }
  }, [authStatus.hasOAuthTokens]);

  // Listen for auth status changes
  useEffect(() => {
    const handleAuthChange = () => {
      setAuthStatus(persistentAuth.getAuthStatus());
    };

    persistentAuth.on('tokenStored', handleAuthChange);
    persistentAuth.on('tokenValidated', handleAuthChange);
    persistentAuth.on('authExpired', handleAuthChange);

    return () => {
      persistentAuth.off('tokenStored', handleAuthChange);
      persistentAuth.off('tokenValidated', handleAuthChange);
      persistentAuth.off('authExpired', handleAuthChange);
    };
  }, []);

  const loadRepositories = async () => {
    try {
      setLoading(true);
      setError(null);

      let token = await persistentAuth.getAccessToken();
      if (!token) {
        throw new Error('No access token available');
      }

      // Fetch user repositories from GitHub API
      let response = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100', {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Try to refresh token and retry once
          try {
            await persistentAuth.refreshAccessToken?.();
            token = await persistentAuth.getAccessToken();
            if (!token) throw new Error('Authentication expired. Please sign in again.');
            response = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100', {
              headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
              }
            });
          } catch (e) {
            throw new Error('Authentication expired. Please sign in again.');
          }
        }
        if (!response.ok) {
          throw new Error(`Failed to load repositories: ${response.status}`);
        }
      }

      const repos = await response.json();
      
      // Transform repository data for our component
      const transformedRepos = repos.map(repo => ({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description,
        private: repo.private,
        html_url: repo.html_url,
        clone_url: repo.clone_url,
        created_at: repo.created_at,
        updated_at: repo.updated_at,
        owner: repo.owner,
        permissions: repo.permissions
      }));

      setRepositories(transformedRepos);

    } catch (err) {
      console.error('Failed to load repositories:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRepository = async () => {
    try {
      // Prompt for repository name
      const name = prompt('Enter repository name for your new ontology:');
      if (!name || !name.trim()) return;

      const trimmedName = name.trim();
      
      // Check if repository already exists
      if (repositories.some(repo => repo.name.toLowerCase() === trimmedName.toLowerCase())) {
        alert('A repository with this name already exists.');
        return;
      }

      setLoading(true);
      setError(null);

      const token = await persistentAuth.getAccessToken();
      if (!token) {
        throw new Error('Please sign in with GitHub first');
      }

      // Create repository via our backend
      const response = await oauthFetch('/api/github/oauth/create-repository', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          access_token: token,
          name: trimmedName,
          private: true, // Default to private for ontologies
          description: `Ontology repository: ${trimmedName}`,
          auto_init: true
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create repository: ${response.status} ${errorText}`);
      }

      const newRepo = await response.json();
      
      // Add the new repository to our list
      const transformedRepo = {
        id: newRepo.id,
        name: newRepo.name,
        full_name: newRepo.full_name,
        description: newRepo.description,
        private: newRepo.private,
        html_url: newRepo.html_url,
        clone_url: newRepo.clone_url,
        created_at: newRepo.created_at,
        updated_at: newRepo.updated_at,
        owner: { login: authStatus.userData?.login || 'user' },
        permissions: { admin: true, push: true, pull: true }
      };

      setRepositories(prev => [transformedRepo, ...prev]);

      // Automatically select the new repository
      if (onSelectRepository) {
        onSelectRepository(transformedRepo);
      }

    } catch (err) {
      console.error('Failed to create repository:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveRepository = (repo) => {
    if (confirm(`Remove "${repo.name}" from your repository list? This won't delete the repository from GitHub.`)) {
      setRepositories(prev => prev.filter(r => r.id !== repo.id));
    }
  };

  const handleRefresh = () => {
    loadRepositories();
  };

  // Debug auth status
  console.log('[RepositoryManager] Auth status check:', { 
    hasOAuthTokens: authStatus.hasOAuthTokens, 
    hasUserData: !!authStatus.userData?.login,
    authStatus 
  });
  
  if (!authStatus.hasOAuthTokens) {
    if (dropdownMode) {
      return (
        <div style={{ 
          padding: '12px', 
          textAlign: 'center',
          color: '#666',
          fontSize: '0.8rem',
          fontFamily: "'EmOne', sans-serif"
        }}>
          <Github size={16} color="#666" style={{ marginBottom: '8px' }} />
          <div>Please sign in with GitHub first</div>
        </div>
      );
    }
    
    return (
      <div style={{ 
        padding: '40px 20px',
        textAlign: 'center',
        fontFamily: "'EmOne', sans-serif",
        color: '#666'
      }}>
        <Users size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
        <div style={{ marginBottom: '8px' }}>Sign in with GitHub to manage your ontologies</div>
        <div style={{ fontSize: '0.8rem' }}>
          Connect your GitHub account to browse and create ontology repositories
        </div>
      </div>
    );
  }

  // Dropdown mode - compact repository selector
  if (dropdownMode) {
    return (
      <div style={{ 
        fontFamily: "'EmOne', sans-serif",
        minWidth: '300px'
      }}>
        {/* Header */}
        <div style={{ 
          padding: '12px',
          borderBottom: '1px solid #260000',
          backgroundColor: '#979090'
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '4px'
          }}>
            <span style={{ 
              fontSize: '0.9rem',
              fontWeight: '600',
              color: '#260000'
            }}>
              Select Repository
            </span>
            <button
              onClick={handleRefresh}
              disabled={loading}
              style={{
                padding: '2px',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
                color: '#260000'
              }}
            >
              <RefreshCw size={14} style={{ 
                animation: loading ? 'spin 1s linear infinite' : 'none' 
              }} />
            </button>
          </div>
          
          {authStatus.userData && (
            <div style={{ 
              fontSize: '0.75rem', 
              color: '#666',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <Github size={12} />
              @{authStatus.userData.login}
            </div>
          )}
        </div>

        {/* Repository List */}
        <div style={{ 
          maxHeight: '200px',
          overflowY: 'auto',
          backgroundColor: '#bdb5b5'
        }}>
          {error && (
            <div style={{ 
              padding: '8px', 
              backgroundColor: '#ffebee', 
              color: '#d32f2f',
              fontSize: '0.75rem',
              borderBottom: '1px solid #f44336'
            }}>
              {error}
            </div>
          )}
          
          {loading ? (
            <div style={{ 
              padding: '16px', 
              textAlign: 'center',
              color: '#666',
              fontSize: '0.8rem'
            }}>
              Loading...
            </div>
          ) : repositories.length > 0 ? (
            <>
              {repositories.map((repo) => (
                <div
                  key={repo.id}
                  onClick={() => onSelectRepository(repo)}
                  style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid #979090',
                    cursor: 'pointer',
                    color: '#260000',
                    transition: 'background-color 0.2s',
                  }}
                  onMouseEnter={(e) => e.target.style.backgroundColor = '#979090'}
                  onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                >
                  <div style={{ 
                    fontWeight: '500',
                    fontSize: '0.85rem',
                    marginBottom: '2px'
                  }}>
                    {repo.name}
                  </div>
                  <div style={{ 
                    fontSize: '0.7rem', 
                    color: '#666',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {repo.description || 'No description'}
                  </div>
                </div>
              ))}
              
              {/* Add New Repository Option */}
              {showCreateOption && (
                <div
                  onClick={handleCreateRepository}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    color: '#260000',
                    backgroundColor: '#979090',
                    borderTop: '2px solid #260000',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontWeight: '500',
                    fontSize: '0.85rem'
                  }}
                  onMouseEnter={(e) => e.target.style.backgroundColor = '#bdb5b5'}
                  onMouseLeave={(e) => e.target.style.backgroundColor = '#979090'}
                >
                  <Plus size={14} />
                  Create New Repository
                </div>
              )}
            </>
          ) : (
            <div style={{ 
              padding: '16px', 
              textAlign: 'center',
              color: '#666',
              fontSize: '0.8rem'
            }}>
              <div style={{ marginBottom: '8px' }}>No repositories found</div>
              {showCreateOption && (
                <button
                  onClick={handleCreateRepository}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#260000',
                    color: '#bdb5b5',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    fontFamily: "'EmOne', sans-serif"
                  }}
                >
                  Create First Repository
                </button>
              )}
            </div>
          )}
        </div>
        
        <style>
          {`
            @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
          `}
        </style>
      </div>
    );
  }

  // Full mode - original interface
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header with refresh button */}
      <div style={{ 
        padding: '8px 16px',
        backgroundColor: '#bdb5b5',
        borderBottom: '1px solid #979090',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ 
          fontSize: '0.8rem',
          color: '#666',
          fontFamily: "'EmOne', sans-serif"
        }}>
          {authStatus.userData?.login && `@${authStatus.userData.login}'s ontologies`}
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          style={{
            background: 'none',
            border: 'none',
            color: '#260000',
            cursor: loading ? 'not-allowed' : 'pointer',
            padding: '4px',
            opacity: loading ? 0.5 : 0.7,
            transition: 'opacity 0.2s'
          }}
          onMouseEnter={(e) => !loading && (e.target.style.opacity = '1')}
          onMouseLeave={(e) => !loading && (e.target.style.opacity = '0.7')}
          title="Refresh repositories"
        >
          <RefreshCw size={16} style={{ 
            animation: loading ? 'spin 1s linear infinite' : 'none' 
          }} />
        </button>
      </div>

      {/* Error display */}
      {error && (
        <div style={{ 
          padding: '12px 16px',
          backgroundColor: '#ffebee',
          border: '1px solid #f44336',
          color: '#d32f2f',
          fontSize: '0.8rem',
          fontFamily: "'EmOne', sans-serif"
        }}>
          {error}
        </div>
      )}

      {/* Repository list */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <RepositoryList
          repositories={repositories}
          onSelectRepository={onSelectRepository}
          onCreateRepository={showCreateOption ? handleCreateRepository : null}
          onRemoveRepository={handleRemoveRepository}
          onAddToList={onAddToList}
          managedRepositories={managedRepositories}
          currentUser={authStatus.userData?.login}
          isOwner={true}
          title="My Ontologies"
        />
      </div>

      {/* Loading overlay */}
      {loading && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(189, 181, 181, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.9rem',
          fontFamily: "'EmOne', sans-serif",
          color: '#260000'
        }}>
          Loading repositories...
        </div>
      )}

      <style>
        {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
};

export default RepositoryManager;
