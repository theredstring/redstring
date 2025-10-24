/**
 * Repository List Component
 * Manages a sortable list of repositories for users/organizations
 * Each repository represents one ontology with read/write access
 */

import React, { useState, useEffect } from 'react';
import {
  GitBranch,
  Plus,
  Search,
  Book,
  Users,
  Lock,
  Unlock,
  Calendar,
  ArrowUpDown,
  ExternalLink,
  Settings,
  Trash2,
  ListPlus,
  ChevronDown,
  ChevronRight,
  FileText,
  RefreshCw,
  EyeOff,
  Eye
} from 'lucide-react';
import { gitFederationService } from '../../services/gitFederationService.js';

const RepositoryList = ({
  repositories = [],
  onSelectRepository,
  onCreateRepository,
  onRemoveRepository,
  onToggleDisabled, // NEW: Toggle repo disabled status
  onAddToList, // NEW: Add repo to managed list
  managedRepositories = [], // NEW: Already-managed repos
  currentUser,
  isOwner = false,
  title = "Repositories"
}) => {
  const [sortBy, setSortBy] = useState('updated'); // 'name', 'updated', 'created', 'private'
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc', 'desc'
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredRepos, setFilteredRepos] = useState([]);
  const [expandedRepos, setExpandedRepos] = useState(new Set());
  const [discoveredUniverses, setDiscoveredUniverses] = useState({});

  // Filter and sort repositories
  useEffect(() => {
    let filtered = repositories.filter(repo => 
      repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (repo.description && repo.description.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    // Sort repositories
    filtered.sort((a, b) => {
      let aVal, bVal;
      
      switch (sortBy) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'updated':
          aVal = new Date(a.updated_at || a.updated || 0);
          bVal = new Date(b.updated_at || b.updated || 0);
          break;
        case 'created':
          aVal = new Date(a.created_at || a.created || 0);
          bVal = new Date(b.created_at || b.created || 0);
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

    setFilteredRepos(filtered);
  }, [repositories, searchQuery, sortBy, sortOrder]);

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

  const getSortIcon = (field) => {
    if (sortBy !== field) return <ArrowUpDown size={12} style={{ opacity: 0.5 }} />;
    return <ArrowUpDown size={12} style={{ transform: sortOrder === 'desc' ? 'rotate(180deg)' : 'none' }} />;
  };

  const toggleRepoExpansion = async (repo) => {
    const repoKey = `${repo.owner?.login || repo.owner}/${repo.name}`;
    const newExpanded = new Set(expandedRepos);

    if (newExpanded.has(repoKey)) {
      newExpanded.delete(repoKey);
      setExpandedRepos(newExpanded);
    } else {
      newExpanded.add(repoKey);
      setExpandedRepos(newExpanded);

      // Discover universes if not already cached
      if (!discoveredUniverses[repoKey]) {
        try {
          const universes = await gitFederationService.discoverUniverses({
            user: repo.owner?.login || repo.owner,
            repo: repo.name,
            authMethod: 'oauth'
          });

          setDiscoveredUniverses(prev => ({
            ...prev,
            [repoKey]: universes || []
          }));
        } catch (err) {
          console.warn('Failed to discover universes for repo:', repoKey, err);
          setDiscoveredUniverses(prev => ({
            ...prev,
            [repoKey]: []
          }));
        }
      }
    }
  };

  return (
    <div style={{ 
      fontFamily: "'EmOne', sans-serif", 
      color: '#260000',
      height: '100%',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header */}
      <div style={{ 
        padding: '16px',
        borderBottom: '1px solid #979090',
        backgroundColor: '#bdb5b5'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Book size={20} />
            {title}
            {repositories.length > 0 && (
              <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>({repositories.length})</span>
            )}
          </h3>
          {isOwner && onCreateRepository && (
            <button
              onClick={onCreateRepository}
              style={{
                padding: '6px 12px',
                backgroundColor: '#260000',
                color: '#bdb5b5',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Plus size={14} />
              New Ontology
            </button>
          )}
        </div>

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <Search 
            size={16} 
            style={{ 
              position: 'absolute', 
              left: '8px', 
              top: '50%', 
              transform: 'translateY(-50%)',
              opacity: 0.6
            }} 
          />
          <input
            type="text"
            placeholder="Search repositories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 8px 8px 32px',
              border: '1px solid #979090',
              borderRadius: '4px',
              fontSize: '0.9rem',
              backgroundColor: '#979090',
              color: '#260000',
              boxSizing: 'border-box'
            }}
          />
        </div>
      </div>

      {/* Sort Controls */}
      <div style={{ 
        padding: '8px 16px',
        backgroundColor: '#979090',
        borderBottom: '1px solid #260000',
        display: 'flex',
        gap: '12px',
        fontSize: '0.8rem'
      }}>
        <button
          onClick={() => handleSort('name')}
          style={{
            background: 'none',
            border: 'none',
            color: sortBy === 'name' ? '#260000' : '#666',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontWeight: sortBy === 'name' ? 'bold' : 'normal'
          }}
        >
          Name {getSortIcon('name')}
        </button>
        <button
          onClick={() => handleSort('updated')}
          style={{
            background: 'none',
            border: 'none',
            color: sortBy === 'updated' ? '#260000' : '#666',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontWeight: sortBy === 'updated' ? 'bold' : 'normal'
          }}
        >
          Updated {getSortIcon('updated')}
        </button>
        <button
          onClick={() => handleSort('private')}
          style={{
            background: 'none',
            border: 'none',
            color: sortBy === 'private' ? '#260000' : '#666',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontWeight: sortBy === 'private' ? 'bold' : 'normal'
          }}
        >
          Privacy {getSortIcon('private')}
        </button>
      </div>

      {/* Repository List */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {filteredRepos.length === 0 ? (
          <div style={{ 
            padding: '40px 20px',
            textAlign: 'center',
            color: '#666',
            fontSize: '0.9rem'
          }}>
            {repositories.length === 0 ? (
              <>
                <Book size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
                <div>No ontologies yet</div>
                {isOwner && (
                  <div style={{ fontSize: '0.8rem', marginTop: '8px' }}>
                    Create your first ontology to get started
                  </div>
                )}
              </>
            ) : (
              <>
                <Search size={32} style={{ opacity: 0.3, marginBottom: '12px' }} />
                <div>No repositories match "{searchQuery}"</div>
              </>
            )}
          </div>
        ) : (
          filteredRepos.map((repo) => {
            const repoKey = `${repo.owner?.login || repo.owner}/${repo.name}`;
            const isExpanded = expandedRepos.has(repoKey);
            const universes = discoveredUniverses[repoKey] || [];

            return (
            <div
              key={repo.id || repo.full_name}
              style={{
                borderBottom: '1px solid #bdb5b5',
                backgroundColor: repo.disabled ? '#b0b0b0' : '#979090',
                opacity: repo.disabled ? 0.6 : 1
              }}
            >
              {/* Main repository row */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between'
                }}
              >
              {/* Clickable main content area */}
              <div
                onClick={() => onSelectRepository && onSelectRepository(repo)}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  cursor: onSelectRepository ? 'pointer' : 'default',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => {
                  if (onSelectRepository) {
                    e.target.style.backgroundColor = '#bdb5b5';
                  }
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = 'transparent';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <GitBranch size={16} />
                  <span style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>
                    {repo.name}
                  </span>
                  {repo.private ? (
                    <Lock size={12} style={{ opacity: 0.6 }} />
                  ) : (
                    <Unlock size={12} style={{ opacity: 0.6 }} />
                  )}

                  {/* Universe count indicator */}
                  {isExpanded && universes.length > 0 && (
                    <span style={{
                      fontSize: '0.7rem',
                      color: '#fff',
                      backgroundColor: '#260000',
                      padding: '2px 6px',
                      borderRadius: '3px'
                    }}>
                      {universes.length} universe{universes.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>

                {repo.description && (
                  <div style={{
                    fontSize: '0.8rem',
                    color: '#333',
                    marginBottom: '6px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {repo.description}
                  </div>
                )}

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  fontSize: '0.75rem',
                  color: '#666'
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Calendar size={12} />
                    Updated {formatDate(repo.updated_at || repo.updated)}
                  </span>
                  {repo.owner && repo.owner.login && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Users size={12} />
                      {repo.owner.login}
                    </span>
                  )}
                </div>
              </div>

              {/* Action buttons area - separate from clickable content */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '12px 16px 12px 0',
                flexShrink: 0
              }}>
                {/* Expand/collapse button */}
                <button
                  onClick={() => toggleRepoExpansion(repo)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#260000',
                    cursor: 'pointer',
                    padding: '2px',
                    opacity: 0.7,
                    transition: 'opacity 0.2s'
                  }}
                  onMouseEnter={(e) => e.target.style.opacity = '1'}
                  onMouseLeave={(e) => e.target.style.opacity = '0.7'}
                  title={isExpanded ? 'Hide universes' : 'Show universes'}
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>

                {repo.html_url && (
                  <a
                    href={repo.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: '#260000',
                      opacity: 0.7,
                      transition: 'opacity 0.2s',
                      textDecoration: 'none'
                    }}
                    onMouseEnter={(e) => e.target.style.opacity = '1'}
                    onMouseLeave={(e) => e.target.style.opacity = '0.7'}
                  >
                    <ExternalLink size={14} />
                  </a>
                )}

                {onAddToList && !managedRepositories.some(r =>
                  `${r.owner?.login || r.owner}/${r.name}` === `${repo.owner?.login || repo.owner}/${repo.name}`
                ) && (
                  <button
                    onClick={() => onAddToList(repo)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#2e7d32',
                      cursor: 'pointer',
                      padding: '2px',
                      opacity: 0.7,
                      transition: 'opacity 0.2s'
                    }}
                    onMouseEnter={(e) => e.target.style.opacity = '1'}
                    onMouseLeave={(e) => e.target.style.opacity = '0.7'}
                    title="Add to my repositories"
                  >
                    <ListPlus size={14} />
                  </button>
                )}

                {isOwner && onToggleDisabled && (
                  <button
                    onClick={() => onToggleDisabled(repo)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: repo.disabled ? '#ef6c00' : '#666',
                      cursor: 'pointer',
                      padding: '2px',
                      opacity: 0.7,
                      transition: 'opacity 0.2s'
                    }}
                    onMouseEnter={(e) => e.target.style.opacity = '1'}
                    onMouseLeave={(e) => e.target.style.opacity = '0.7'}
                    title={repo.disabled ? 'Enable repository' : 'Disable repository'}
                  >
                    {repo.disabled ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                )}

                {isOwner && onRemoveRepository && (
                  <button
                    onClick={() => onRemoveRepository(repo)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#d32f2f',
                      cursor: 'pointer',
                      padding: '2px',
                      opacity: 0.7,
                      transition: 'opacity 0.2s'
                    }}
                    onMouseEnter={(e) => e.target.style.opacity = '1'}
                    onMouseLeave={(e) => e.target.style.opacity = '0.7'}
                    title="Remove from list"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
              </div>

              {/* Expandable universe section */}
              {isExpanded && (
                <div style={{
                  backgroundColor: '#bdb5b5',
                  borderTop: '1px solid #979090',
                  padding: '12px 16px'
                }}>
                  {discoveredUniverses[repoKey] === undefined ? (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '0.8rem',
                      color: '#666'
                    }}>
                      <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
                      Scanning for universes...
                    </div>
                  ) : universes.length === 0 ? (
                    <div style={{
                      fontSize: '0.8rem',
                      color: '#666',
                      fontStyle: 'italic'
                    }}>
                      No universes found in this repository
                    </div>
                  ) : (
                    <div>
                      <div style={{
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        color: '#260000',
                        marginBottom: '8px'
                      }}>
                        Found {universes.length} universe{universes.length === 1 ? '' : 's'}:
                      </div>
                      {universes.map((universe, index) => (
                        <div
                          key={index}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '0.75rem',
                            color: '#333',
                            marginBottom: index < universes.length - 1 ? '4px' : '0',
                            padding: '4px 8px',
                            backgroundColor: '#979090',
                            borderRadius: '4px'
                          }}
                        >
                          <FileText size={12} />
                          <span style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1
                          }}>
                            {universe.name || universe.path || `Universe ${index + 1}`}
                          </span>
                          {universe.path && (
                            <span style={{
                              opacity: 0.6,
                              fontSize: '0.65rem'
                            }}>
                              ({universe.path})
                            </span>
                          )}
                        </div>
                      ))}
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
    </div>
  );
};

export default RepositoryList;
