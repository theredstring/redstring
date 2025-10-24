import React, { useState, useEffect } from 'react';
import {
  Github,
  Search,
  Plus,
  RefreshCw,
  Book,
  Lock,
  Unlock,
  ExternalLink,
  Calendar,
  Users,
  ArrowUpDown,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  FileText
} from 'lucide-react';
import Modal from '../shared/Modal.jsx';
import { persistentAuth } from '../../services/persistentAuth.js';
import { gitFederationService } from '../../services/gitFederationService.js';

const RepositorySelectionModal = ({
  isOpen,
  onClose,
  onSelectRepository,
  onAddToManagedList,
  managedRepositories = [],
  intent = null,
  onImportDiscovered,
  onSyncDiscovered
}) => {
  const [repositories, setRepositories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('updated');
  const [sortOrder, setSortOrder] = useState('desc');
  const [authStatus, setAuthStatus] = useState(persistentAuth.getAuthStatus());
  const [expandedRepos, setExpandedRepos] = useState(new Set());
  const [discoveredUniverses, setDiscoveredUniverses] = useState({});
  const [showCreateRepo, setShowCreateRepo] = useState(false);
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoPrivate, setNewRepoPrivate] = useState(true);
  const [creatingRepo, setCreatingRepo] = useState(false);
  const [createRepoError, setCreateRepoError] = useState(null);

  const modalTitle = intent === 'import'
    ? 'Import From Repository'
    : intent === 'attach'
      ? 'Attach Repository'
      : 'Add Repositories';

  const selectLabel = intent === 'import'
    ? 'Import'
    : intent === 'attach'
      ? 'Attach'
      : 'Select';

  const addLabel = intent === 'import'
    ? 'Add & Import'
    : intent === 'attach'
      ? 'Add & Attach'
      : 'Add';

  const intentMessage = intent === 'import'
    ? 'Pick a repository to import an existing universe. Only files inside the universes/ folder will be listed.'
    : intent === 'attach'
      ? 'Choose the repository you want to sync with this universe. Only files inside the universes/ folder will be listed.'
      : intent === 'create'
        ? 'Create a repository or choose an existing one. When attaching, make sure your universe lives in the universes/ folder.'
        : null;

  // Listen for auth state changes
  useEffect(() => {
    const updateAuthStatus = () => {
      const freshStatus = persistentAuth.getAuthStatus();
      setAuthStatus(freshStatus);
    };

    // Update auth status when modal opens (in case auth loaded after component mounted)
    if (isOpen) {
      updateAuthStatus();
    }

    // Listen for auth events
    const handleAuthEvent = () => {
      updateAuthStatus();
    };

    window.addEventListener('redstring:auth-connected', handleAuthEvent);
    window.addEventListener('redstring:auth-token-stored', handleAuthEvent);
    persistentAuth.on('tokenStored', updateAuthStatus);
    persistentAuth.on('tokenValidated', updateAuthStatus);
    persistentAuth.on('appInstallationStored', updateAuthStatus);

    return () => {
      window.removeEventListener('redstring:auth-connected', handleAuthEvent);
      window.removeEventListener('redstring:auth-token-stored', handleAuthEvent);
      persistentAuth.off('tokenStored', updateAuthStatus);
      persistentAuth.off('tokenValidated', updateAuthStatus);
      persistentAuth.off('appInstallationStored', updateAuthStatus);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && authStatus.hasOAuthTokens) {
      loadRepositories();
    }
  }, [isOpen, authStatus.hasOAuthTokens]);

  const loadRepositories = async () => {
    try {
      setLoading(true);
      setError(null);

      // OAuth is required for UI repository browsing
      // GitHub App is only used for backend operations
      let token = await persistentAuth.getAccessToken();
      if (!token) {
        throw new Error('GitHub OAuth required to browse repositories. Please connect OAuth in Accounts & Access.');
      }

      const response = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100', {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        // Try to get error details from response body
        const errorBody = await response.json().catch(() => ({}));
        const errorMessage = errorBody?.message || errorBody?.error || '';

        console.error('GitHub API error:', {
          status: response.status,
          statusText: response.statusText,
          errorBody,
          headers: response.headers
        });

        if (response.status === 401) {
          // Try to refresh OAuth token
          try {
            await persistentAuth.refreshAccessToken?.();
            token = await persistentAuth.getAccessToken();
            if (!token) throw new Error('OAuth authentication expired. Please reconnect in Accounts & Access.');

            // Retry the request with refreshed token
            const retryResponse = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100', {
              headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
              }
            });

            if (!retryResponse.ok) {
              throw new Error('OAuth authentication expired. Please reconnect in Accounts & Access.');
            }

            const repos = await retryResponse.json();
            setRepositories(repos);
            return;
          } catch (e) {
            throw new Error('OAuth authentication expired. Please reconnect in Accounts & Access.');
          }
        } else if (response.status === 403) {
          // 403 could be rate limiting or insufficient permissions
          if (errorMessage.includes('rate limit')) {
            throw new Error('GitHub API rate limit exceeded. Please wait a few minutes and try again.');
          } else if (errorMessage.includes('scope')) {
            throw new Error(`Insufficient permissions. ${errorMessage}`);
          } else {
            throw new Error(`Access forbidden (403). ${errorMessage || 'Your token may lack necessary permissions (repo scope required).'}`);
          }
        } else {
          throw new Error(`Failed to load repositories: ${response.status}. ${errorMessage}`);
        }
      }

      const repos = await response.json();
      setRepositories(repos);
    } catch (err) {
      console.error('Failed to load repositories:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRepository = async () => {
    const trimmedName = newRepoName.trim();
    if (!trimmedName) {
      setCreateRepoError('Repository name is required.');
      return;
    }

    try {
      setCreatingRepo(true);
      setCreateRepoError(null);

      // OAuth is required for creating repositories
      let token = await persistentAuth.getAccessToken();
      if (!token) {
        throw new Error('GitHub OAuth required to create repositories. Please connect OAuth in Accounts & Access.');
      }

      const response = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: trimmedName,
          private: newRepoPrivate,
          auto_init: true
        })
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const message = errorBody?.message || `Failed to create repository (status ${response.status})`;
        throw new Error(message);
      }

      const createdRepo = await response.json();

      setRepositories((prev) => [createdRepo, ...prev]);
      onAddToManagedList?.({
        owner: createdRepo.owner?.login || createdRepo.owner?.name || createdRepo.owner,
        name: createdRepo.name,
        private: createdRepo.private
      });

      setShowCreateRepo(false);
      setNewRepoName('');
      setNewRepoPrivate(true);
    } catch (err) {
      console.error('Failed to create repository:', err);
      setCreateRepoError(err.message || 'Repository creation failed.');
    } finally {
      setCreatingRepo(false);
    }
  };

  const toggleRepoExpansion = async (repoId) => {
    const newExpanded = new Set(expandedRepos);

    if (newExpanded.has(repoId)) {
      newExpanded.delete(repoId);
      setExpandedRepos(newExpanded);
    } else {
      newExpanded.add(repoId);
      setExpandedRepos(newExpanded);

      // Discover universes if not already cached
      if (!discoveredUniverses[repoId]) {
        try {
          const repo = repositories.find(r => r.id === repoId);
          if (repo?.owner?.login && repo?.name) {
            const universes = await gitFederationService.discoverUniverses({
              user: repo.owner.login,
              repo: repo.name,
              authMethod: 'oauth'
            });

            setDiscoveredUniverses(prev => ({
              ...prev,
              [repoId]: universes || []
            }));
          }
        } catch (err) {
          console.warn('Failed to discover universes for repo:', repoId, err);
          setDiscoveredUniverses(prev => ({
            ...prev,
            [repoId]: []
          }));
        }
      }
    }
  };

  const filteredAndSortedRepos = repositories
    .filter(repo =>
      repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (repo.description && repo.description.toLowerCase().includes(searchQuery.toLowerCase()))
    )
    .sort((a, b) => {
      let aVal, bVal;

      switch (sortBy) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'updated':
          aVal = new Date(a.updated_at || 0);
          bVal = new Date(b.updated_at || 0);
          break;
        case 'created':
          aVal = new Date(a.created_at || 0);
          bVal = new Date(b.created_at || 0);
          break;
        case 'private':
          aVal = a.private ? 1 : 0;
          bVal = b.private ? 1 : 0;
          break;
        default:
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
      }

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

  const handleSort = (newSortBy) => {
    if (sortBy === newSortBy) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(newSortBy);
      setSortOrder('desc');
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
    });
  };

  const isAlreadyManaged = (repo) => {
    return managedRepositories.some(r =>
      `${r.owner?.login || r.owner}/${r.name}` === `${repo.owner?.login || repo.owner}/${repo.name}`
    );
  };

  if (!authStatus.hasOAuthTokens) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Repository Selection" size="medium">
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: '16px',
          color: '#666',
          padding: '40px'
        }}>
          <Github size={48} style={{ opacity: 0.3 }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '8px' }}>
              GitHub Authentication Required
            </div>
            <div style={{ fontSize: '0.9rem' }}>
              Please sign in with GitHub to browse your repositories
            </div>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} size="slim">
      {/* Compact search */}
      <div style={{
        padding: '12px',
        borderBottom: '1px solid #979090',
        backgroundColor: '#bdb5b5',
        flexShrink: 0
      }}>
        <div style={{ position: 'relative', marginBottom: '10px' }}>
          <Search
            size={14}
            style={{
              position: 'absolute',
              left: '8px',
              top: '50%',
              transform: 'translateY(-50%)',
              opacity: 0.6,
              color: '#260000'
            }}
          />
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 8px 8px 28px',
              border: '1px solid #979090',
              borderRadius: '4px',
              fontSize: '0.8rem',
              backgroundColor: '#979090',
              color: '#260000',
              boxSizing: 'border-box',
              fontFamily: "'EmOne', sans-serif"
            }}
          />
        </div>

        {/* Compact controls */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.7rem'
        }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {[
              { key: 'updated', label: 'Recent' },
              { key: 'name', label: 'A-Z' }
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleSort(key)}
                style={{
                  background: sortBy === key ? '#260000' : 'none',
                  color: sortBy === key ? '#bdb5b5' : '#666',
                  border: '1px solid #260000',
                  padding: '2px 6px',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '0.7rem',
                  fontFamily: "'EmOne', sans-serif"
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#444' }}>
              {filteredAndSortedRepos.length}
            </span>
            <button
              onClick={loadRepositories}
              disabled={loading}
              style={{
                background: 'none',
                border: 'none',
                color: '#260000',
                cursor: loading ? 'not-allowed' : 'pointer',
                padding: '2px',
                opacity: loading ? 0.6 : 0.8
              }}
            >
              <RefreshCw size={10} style={{
                animation: loading ? 'spin 1s linear infinite' : 'none'
              }} />
            </button>
            <button
              onClick={() => {
                setShowCreateRepo(prev => !prev);
                setCreateRepoError(null);
              }}
              style={{
                background: 'none',
                border: '1px solid #260000',
                color: '#260000',
                padding: '2px 6px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '0.7rem',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Plus size={10} />
              New Repo
            </button>
          </div>
        </div>

        {showCreateRepo && (
          <div style={{
            marginTop: '10px',
            padding: '10px',
            border: '1px solid #979090',
            borderRadius: '6px',
            backgroundColor: '#cfc6c6',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.7rem', fontWeight: 600, color: '#260000' }}>
                Repository Name
              </label>
              <input
                type="text"
                value={newRepoName}
                onChange={(e) => setNewRepoName(e.target.value)}
                placeholder="my-new-repo"
                style={{
                  padding: '6px 8px',
                  border: '1px solid #979090',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  backgroundColor: '#bdb5b5',
                  color: '#260000'
                }}
              />
            </div>

            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.7rem',
              color: '#260000'
            }}>
              <input
                type="checkbox"
                checked={newRepoPrivate}
                onChange={(e) => setNewRepoPrivate(e.target.checked)}
              />
              Private repository
            </label>

            {createRepoError && (
              <div style={{
                fontSize: '0.7rem',
                color: '#7A0000',
                backgroundColor: 'rgba(122,0,0,0.1)',
                padding: '6px 8px',
                borderRadius: '4px'
              }}>
                {createRepoError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={handleCreateRepository}
                disabled={creatingRepo}
                style={{
                  background: '#260000',
                  color: '#bdb5b5',
                  border: '1px solid #260000',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontSize: '0.7rem',
                  cursor: creatingRepo ? 'not-allowed' : 'pointer',
                  opacity: creatingRepo ? 0.6 : 1
                }}
              >
                {creatingRepo ? 'Creating…' : 'Create Repository'}
              </button>
            </div>
          </div>
        )}
      </div>

      {intentMessage && (
        <div
          style={{
            padding: '10px 12px',
            backgroundColor: intent === 'import' ? 'rgba(21,101,192,0.12)' : 'rgba(38,0,0,0.08)',
            borderBottom: '1px solid #979090',
            color: '#260000',
            fontSize: '0.78rem',
            lineHeight: 1.4
          }}
        >
          {intentMessage}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div style={{
          padding: '8px 12px',
          backgroundColor: '#ffebee',
          borderBottom: '1px solid #f44336',
          color: '#d32f2f',
          fontSize: '0.75rem'
        }}>
          {error}
        </div>
      )}

      {/* Repository list */}
      <div style={{ flex: 1, overflow: 'auto', paddingTop: '8px', paddingBottom: '8px' }}>
        {loading ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '60px',
            color: '#666'
          }}>
            <RefreshCw size={24} style={{ animation: 'spin 1s linear infinite', marginRight: '12px' }} />
            Loading repositories...
          </div>
        ) : filteredAndSortedRepos.length === 0 ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            padding: '60px',
            color: '#666',
            gap: '12px'
          }}>
            {repositories.length === 0 ? (
              <>
                <Book size={48} style={{ opacity: 0.3 }} />
                <div>No repositories found</div>
              </>
            ) : (
              <>
                <Search size={32} style={{ opacity: 0.3 }} />
                <div>No repositories match "{searchQuery}"</div>
              </>
            )}
          </div>
        ) : (
          filteredAndSortedRepos.map((repo) => {
            const isExpanded = expandedRepos.has(repo.id);
            const universes = discoveredUniverses[repo.id] || [];
            const hasUniverses = universes.length > 0;

            return (
            <div
              key={repo.id}
              style={{
                borderBottom: '1px solid #979090',
                backgroundColor: '#bdb5b5'
              }}
            >
              {/* Main repository row */}
              <div
                style={{
                  padding: '10px 12px',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#979090';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
                onClick={(e) => {
                  // Check if the click was on a button or link
                  if (e.target.closest('button') || e.target.closest('a')) {
                    return; // Don't handle if clicking on buttons/links
                  }
                  toggleRepoExpansion(repo.id);
                }}
              >
              {/* Compact repo header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '6px'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  flex: 1,
                  minWidth: 0
                }}>
                  <Github size={14} />
                  <span style={{
                    fontWeight: 'bold',
                    fontSize: '0.85rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {repo.name}
                  </span>
                  {repo.private && <Lock size={10} style={{ opacity: 0.6 }} />}
                  {isAlreadyManaged(repo) && (
                    <CheckCircle size={10} style={{ color: '#2e7d32' }} />
                  )}

                  {/* Universe count indicator */}
                  {isExpanded && universes.length > 0 && (
                    <span style={{
                      fontSize: '0.7rem',
                      color: '#666',
                      backgroundColor: '#979090',
                      padding: '1px 4px',
                      borderRadius: '2px'
                    }}>
                      {universes.length} universe{universes.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  {/* Expand/collapse button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleRepoExpansion(repo.id);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#260000',
                      cursor: 'pointer',
                      padding: '2px',
                      opacity: 0.6,
                      transition: 'opacity 0.2s'
                    }}
                    onMouseEnter={(e) => e.target.style.opacity = '1'}
                    onMouseLeave={(e) => e.target.style.opacity = '0.6'}
                    title={isExpanded ? 'Hide universes' : 'Show universes'}
                  >
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                  {repo.html_url && (
                    <a
                      href={repo.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        color: '#260000',
                        opacity: 0.6,
                        textDecoration: 'none',
                        padding: '2px'
                      }}
                      title="View on GitHub"
                    >
                      <ExternalLink size={12} />
                    </a>
                  )}

                  {isAlreadyManaged(repo) && onSelectRepository && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectRepository(repo);
                      }}
                      style={{
                        background: '#2e7d32',
                        border: 'none',
                        color: '#bdb5b5',
                        cursor: 'pointer',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '2px',
                        fontFamily: "'EmOne', sans-serif"
                      }}
                      title="Select repository"
                    >
                      {selectLabel}
                    </button>
                  )}

                  {onAddToManagedList && !isAlreadyManaged(repo) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddToManagedList(repo);
                        if (onSelectRepository) {
                          onSelectRepository(repo);
                        }
                      }}
                      style={{
                        background: '#260000',
                        border: 'none',
                        color: '#bdb5b5',
                        cursor: 'pointer',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '2px',
                        fontFamily: "'EmOne', sans-serif"
                      }}
                      title="Add to your repository list"
                    >
                      <Plus size={10} />
                      {addLabel}
                    </button>
                  )}
                </div>
              </div>

              {/* Compact description */}
              {repo.description && (
                <div style={{
                  fontSize: '0.7rem',
                  color: '#444',
                  marginBottom: '6px',
                  lineHeight: 1.3,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {repo.description}
                </div>
              )}

              {/* Compact metadata */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.65rem',
                color: '#666'
              }}>
                <span>Updated {formatDate(repo.updated_at)}</span>
                <span>{repo.owner?.login}</span>
              </div>
              </div>

              {/* Expandable universe section */}
              {isExpanded && (
                <div style={{
                  backgroundColor: '#979090',
                  borderTop: '1px solid #808080',
                  padding: '8px 12px'
                }}>
                  {discoveredUniverses[repo.id] === undefined ? (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '0.7rem',
                      color: '#666'
                    }}>
                      <RefreshCw size={10} style={{ animation: 'spin 1s linear infinite' }} />
                      Scanning for universes...
                    </div>
                  ) : universes.length === 0 ? (
                    <div style={{
                      fontSize: '0.7rem',
                      color: '#666',
                      fontStyle: 'italic'
                    }}>
                      No universes found in this repository
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        color: '#260000'
                      }}>
                        Found {universes.length} universe{universes.length === 1 ? '' : 's'}:
                      </div>
                      {universes.map((universe, index) => {
                        const displayName = universe.name || universe.slug || universe.fileName || `Universe ${index + 1}`;
                        const repoInfo = {
                          user: repo.owner?.login || repo.owner,
                          repo: repo.name
                        };

                        return (
                          <div
                            key={`${repo.id}-${universe.path || universe.slug || index}`}
                            style={{
                              border: '1px solid #808080',
                              borderRadius: 6,
                              padding: '8px 10px',
                              backgroundColor: '#cfc6c6',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <FileText size={10} />
                              <div
                                style={{
                                  fontWeight: 600,
                                  fontSize: '0.72rem',
                                  color: '#260000',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {displayName}
                              </div>
                            </div>
                            {universe.path && (
                              <div style={{ fontSize: '0.65rem', color: '#555' }}>{universe.path}</div>
                            )}
                            <div style={{ fontSize: '0.62rem', color: '#7A0000', display: 'flex', gap: 10 }}>
                              {universe.nodeCount !== undefined && (
                                <span>{universe.nodeCount} nodes</span>
                              )}
                              {universe.connectionCount !== undefined && (
                                <span>{universe.connectionCount} connections</span>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              {(onImportDiscovered && (intent === 'import' || intent === null)) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onImportDiscovered(universe, repoInfo);
                                  }}
                                  style={{
                                    background: 'none',
                                    border: '1px solid #1565c0',
                                    color: '#1565c0',
                                    padding: '4px 8px',
                                    borderRadius: 4,
                                    fontSize: '0.68rem',
                                    cursor: 'pointer',
                                    fontWeight: 600
                                  }}
                                >
                                  Import Copy
                                </button>
                              )}
                              {(onSyncDiscovered && (intent === 'attach' || intent === null)) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSyncDiscovered(universe, repoInfo);
                                  }}
                                  style={{
                                    backgroundColor: '#7A0000',
                                    color: '#fff',
                                    border: '1px solid #7A0000',
                                    padding: '4px 8px',
                                    borderRadius: 4,
                                    fontSize: '0.68rem',
                                    cursor: 'pointer',
                                    fontWeight: 600
                                  }}
                                >
                                  Sync to Universe
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            );
          })
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
    </Modal>
  );
};

export default RepositorySelectionModal;
