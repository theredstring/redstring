/**
 * Universe Management Panel - Standalone universe management component
 *
 * This is the SINGLE SOURCE OF TRUTH for universe management UI.
 * Can be used both embedded in GitNativeFederation AND as a standalone modal.
 * Essential for startup and mobile scenarios where it may be the only data access method.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Plus,
  Trash2,
  Edit3,
  Save,
  RefreshCw,
  ExternalLink,
  Github,
  XCircle,
  CheckCircle
} from 'lucide-react';

import universeBackendBridge from '../services/universeBackendBridge.js';
import RepositoryDropdown from './repositories/RepositoryDropdown.jsx';
import { persistentAuth } from '../services/persistentAuth.js';
import { formatUniverseNameFromRepo, buildUniqueUniverseName } from '../utils/universeNaming.js';

// Simple device detection
const getDeviceInfo = () => {
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const screenWidth = window.screen?.width || 1920;
  const isMobile = /android|webos|iphone|ipod|blackberry|iemobile|opera mini/i.test(navigator.userAgent.toLowerCase());
  const isTablet = /ipad|android(?!.*mobile)|kindle|silk|playbook|bb10/i.test(navigator.userAgent.toLowerCase()) ||
                   (/macintosh/i.test(navigator.userAgent.toLowerCase()) && isTouch);

  return {
    isMobile,
    isTablet,
    isTouchDevice: isTouch,
    screenWidth,
    supportsFileSystemAPI: 'showSaveFilePicker' in window,
    gitOnlyMode: isMobile || isTablet || !('showSaveFilePicker' in window)
  };
};

const UniverseManagementPanel = ({
  isModal = false,
  onClose = null,
  showTitle = true,
  className = '',
  style = {}
}) => {
  // State
  const [universes, setUniverses] = useState([]);
  const [activeUniverseSlug, setActiveUniverseSlug] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [authStatus, setAuthStatus] = useState(() => {
    try { return persistentAuth.getAuthStatus(); } catch (_) { return null; }
  });
  const [githubAppInstallation, setGithubAppInstallation] = useState(() => {
    try { return persistentAuth.getAppInstallation(); } catch (_) { return null; }
  });
  const [userRepositories, setUserRepositories] = useState(() => githubAppInstallation?.repositories || []);
  const [isRepoLoading, setIsRepoLoading] = useState(false);

  // UI state
  const containerRef = useRef(null);
  const [isSlim, setIsSlim] = useState(false);
  const deviceInfo = useMemo(() => getDeviceInfo(), []);

  // Backend bridge
  const bridge = universeBackendBridge;

  const canSelectRepositories = useMemo(() => {
    return Boolean(authStatus?.hasOAuthTokens);
  }, [authStatus]);

  // Derived state
  const activeUniverse = useMemo(() => {
    return universes.find(u => u.slug === activeUniverseSlug);
  }, [universes, activeUniverseSlug]);

  const universeCards = useMemo(() => {
    return universes.map(universe => ({
      universe,
      displayName: universe.name || universe.slug
    }));
  }, [universes]);

  // Data loading
  const loadUniverseData = useCallback(async () => {
    try {
      console.log('[UniverseManagementPanel] Loading universe data...');

      const universes = await bridge.getAllUniverses();
      const uniqueUniverses = [];
      const seenSlugs = new Set();

      (universes || []).forEach((u) => {
        if (u?.slug && !seenSlugs.has(u.slug)) {
          seenSlugs.add(u.slug);
          uniqueUniverses.push(u);
        }
      });

      const activeUniverse = await bridge.getActiveUniverse();

      setUniverses(uniqueUniverses);
      setActiveUniverseSlug(activeUniverse?.slug || null);

      console.log(`[UniverseManagementPanel] Loaded ${uniqueUniverses.length} universes, active: ${activeUniverse?.slug}`);
    } catch (error) {
      console.error('[UniverseManagementPanel] Failed to load universe data:', error);
      setError(`Failed to load universe data: ${error.message}`);
    }
  }, [bridge]);

  const fetchUserRepositories = useCallback(async () => {
    if (!canSelectRepositories) {
      setUserRepositories([]);
      return;
    }

    setIsRepoLoading(true);
    try {
      // Prefer stored installation repositories
      const installation = persistentAuth.getAppInstallation();
      setGithubAppInstallation(installation);
      if (installation?.repositories?.length) {
        setUserRepositories(installation.repositories);
      }

      let token = installation?.accessToken || null;
      if (!token) {
        token = await persistentAuth.getAccessToken();
      }

      if (!token) {
        return;
      }

      const response = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100', {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        console.warn('[UniverseManagementPanel] Failed to fetch user repositories:', response.status);
        return;
      }

      const repos = await response.json();
      if (Array.isArray(repos)) {
        setUserRepositories(repos);
      }
    } catch (repoError) {
      console.warn('[UniverseManagementPanel] Repository fetch failed:', repoError);
    } finally {
      setIsRepoLoading(false);
    }
  }, [canSelectRepositories]);

  // Initialize component
  useEffect(() => {
    console.log('[UniverseManagementPanel] Initializing...');

    let unsubscribeRef = null;

    const initializeComponent = async () => {
      try {
        await loadUniverseData();

        // Subscribe to backend status changes
        unsubscribeRef = bridge.onStatusChange((status) => {
          setSyncStatus(status);
          // Refresh data when status changes
          loadUniverseData();
        });
      } catch (error) {
        console.error('[UniverseManagementPanel] Failed to initialize:', error);
        setError(`Failed to initialize universe management: ${error.message}`);
      }
    };

    initializeComponent();

    // Load repositories using cached credentials
    fetchUserRepositories();

    const handleTokenStored = () => {
      try {
        setAuthStatus(persistentAuth.getAuthStatus());
        fetchUserRepositories();
      } catch (tokenError) {
        console.warn('[UniverseManagementPanel] tokenStored handler error:', tokenError);
      }
    };

    const handleAppStored = () => {
      try {
        const installation = persistentAuth.getAppInstallation();
        setGithubAppInstallation(installation);
        setUserRepositories(installation?.repositories || []);
      } catch (appError) {
        console.warn('[UniverseManagementPanel] appInstallationStored handler error:', appError);
      }
    };

    const handleAppCleared = () => {
      setGithubAppInstallation(null);
      setUserRepositories([]);
    };

    persistentAuth.on('tokenStored', handleTokenStored);
    persistentAuth.on('appInstallationStored', handleAppStored);
    persistentAuth.on('appInstallationCleared', handleAppCleared);

    return () => {
      if (unsubscribeRef) {
        unsubscribeRef();
      }
      persistentAuth.off('tokenStored', handleTokenStored);
      persistentAuth.off('appInstallationStored', handleAppStored);
      persistentAuth.off('appInstallationCleared', handleAppCleared);
    };
  }, [bridge, loadUniverseData, fetchUserRepositories]);

  // Observe panel width for responsive layout
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect?.width || el.clientWidth || 0;
        setIsSlim(w < 520);
      }
    });
    ro.observe(el);

    try {
      setIsSlim((el.clientWidth || 0) < 520);
    } catch {}

    return () => ro.disconnect();
  }, []);

  // Universe operations
  const handleSwitchUniverse = async (slug) => {
    if (slug === activeUniverseSlug) return;

    const confirmed = window.confirm('Save current universe before switching?');

    try {
      setIsLoading(true);
      setError(null);

      await bridge.switchActiveUniverse(slug, { saveCurrent: confirmed });
      await loadUniverseData();

    } catch (error) {
      console.error('[UniverseManagementPanel] Failed to switch universe:', error);
      setError(`Failed to switch universe: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateUniverse = async () => {
    const name = prompt('Enter universe name:');
    if (!name?.trim()) return;

    try {
      setIsLoading(true);
      setError(null);

      console.log('[UniverseManagementPanel] Creating universe:', name.trim());
      const result = await bridge.createUniverse(name.trim(), {
        enableGit: deviceInfo.gitOnlyMode
      });
      console.log('[UniverseManagementPanel] Universe creation result:', result);

      await loadUniverseData();

    } catch (error) {
      console.error('[UniverseManagementPanel] Failed to create universe:', error);
      setError(`Failed to create universe: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteUniverse = async (slug) => {
    if (universes.length <= 1) {
      setError('Cannot delete the last universe');
      return;
    }

    const universe = universes.find(u => u.slug === slug);
    if (!universe) return;

    if (!window.confirm(`Delete universe "${universe.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      await bridge.deleteUniverse(slug);
      await loadUniverseData();

    } catch (error) {
      console.error('[UniverseManagementPanel] Failed to delete universe:', error);
      setError(`Failed to delete universe: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRenameUniverse = async (slug, newName) => {
    if (!newName?.trim()) return;

    try {
      await bridge.updateUniverse(slug, { name: newName.trim() });
      await loadUniverseData();
    } catch (error) {
      console.error('[UniverseManagementPanel] Failed to rename universe:', error);
      setError(`Failed to rename universe: ${error.message}`);
    }
  };

  const handleSetSourceOfTruth = async (sourceOfTruth) => {
    if (!activeUniverseSlug) return;

    const active = universes.find(u => u.slug === activeUniverseSlug);
    const nextGitConfig = (() => {
      if (!active?.gitRepo) return undefined;
      if (sourceOfTruth === 'git') {
        return { ...active.gitRepo, enabled: true };
      }
      if (sourceOfTruth === 'local') {
        return { ...active.gitRepo, enabled: false };
      }
      return undefined;
    })();

    try {
      const payload = nextGitConfig ? { sourceOfTruth, gitRepo: nextGitConfig } : { sourceOfTruth };
      await bridge.updateUniverse(activeUniverseSlug, payload);
      await loadUniverseData();
    } catch (error) {
      console.error('[UniverseManagementPanel] Failed to set source of truth:', error);
      setError(`Failed to set source of truth: ${error.message}`);
    }
  };

  const ensureSourceEntry = (universe, owner, repoName) => {
    const existingSources = Array.isArray(universe?.sources) ? [...universe.sources] : [];
    const matchIndex = existingSources.findIndex(src =>
      src?.type === 'github' &&
      src?.user?.toLowerCase() === owner.toLowerCase() &&
      src?.repo?.toLowerCase() === repoName.toLowerCase()
    );

    if (matchIndex >= 0) {
      const existing = existingSources[matchIndex];
      existingSources[matchIndex] = {
        ...existing,
        user: owner,
        repo: repoName,
        name: existing?.name || `@${owner}/${repoName}`,
        enabled: true
      };
      return existingSources;
    }

    return [
      ...existingSources,
      {
        id: `src_${Date.now().toString(36)}`,
        type: 'github',
        user: owner,
        repo: repoName,
        name: `@${owner}/${repoName}`,
        enabled: true,
        addedAt: new Date().toISOString()
      }
    ];
  };

  const handleLinkRepository = async (universe, repository) => {
    if (!universe || !repository) return;

    const owner = repository?.owner?.login || repository?.owner?.name || repository?.owner || (typeof repository?.full_name === 'string' ? repository.full_name.split('/')[0] : null);
    const repoName = repository?.name || (typeof repository?.full_name === 'string' ? repository.full_name.split('/').slice(-1)[0] : null);

    if (!owner || !repoName) {
      setError('Repository selection is missing owner or name details.');
      return;
    }

    const gitRepoConfig = {
      ...(universe.gitRepo || {}),
      enabled: true,
      linkedRepo: {
        type: 'github',
        user: owner,
        repo: repoName,
        private: repository?.private ?? universe.gitRepo?.linkedRepo?.private ?? false
      },
      universeFolder: universe.gitRepo?.universeFolder || `universes/${universe.slug}`,
      universeFile: universe.gitRepo?.universeFile || `${universe.slug}.redstring`
    };

    const formattedName = formatUniverseNameFromRepo(repoName);
    const uniqueName = buildUniqueUniverseName(formattedName, universes, universe.slug);

    const updates = {
      sourceOfTruth: 'git',
      gitRepo: gitRepoConfig,
      sources: ensureSourceEntry(universe, owner, repoName),
      name: uniqueName
    };

    try {
      setSyncStatus({ type: 'info', status: `Linking @${owner}/${repoName}...` });
      await bridge.updateUniverse(universe.slug, updates);
      await loadUniverseData();
      setSyncStatus({ type: 'success', status: `Linked repository @${owner}/${repoName}` });
    } catch (linkError) {
      console.error('[UniverseManagementPanel] Failed to link repository:', linkError);
      setError(`Failed to link repository: ${linkError.message}`);
      setSyncStatus({ type: 'error', status: `Link failed: ${linkError.message}` });
    }
  };

  const handleUnlinkRepository = async (universe) => {
    if (!universe?.slug) return;

    try {
      setSyncStatus({ type: 'info', status: 'Unlinking repository...' });

      const remainingSources = Array.isArray(universe.sources)
        ? universe.sources.filter(src => {
            if (src?.type !== 'github') return true;
            return !(
              universe.gitRepo?.linkedRepo?.user &&
              universe.gitRepo?.linkedRepo?.repo &&
              src.user?.toLowerCase() === universe.gitRepo.linkedRepo.user.toLowerCase() &&
              src.repo?.toLowerCase() === universe.gitRepo.linkedRepo.repo.toLowerCase()
            );
          })
        : [];

      const updates = {
        gitRepo: {
          ...(universe.gitRepo || {}),
          enabled: false,
          linkedRepo: null
        },
        sources: remainingSources
      };

      await bridge.updateUniverse(universe.slug, updates);
      await loadUniverseData();
      setSyncStatus({ type: 'success', status: 'Repository unlinked' });
    } catch (unlinkError) {
      console.error('[UniverseManagementPanel] Failed to unlink repository:', unlinkError);
      setError(`Failed to unlink repository: ${unlinkError.message}`);
      setSyncStatus({ type: 'error', status: `Unlink failed: ${unlinkError.message}` });
    }
  };

  // Clear error after timeout
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const containerStyles = {
    fontFamily: "'EmOne', sans-serif",
    color: '#260000',
    pointerEvents: 'auto',
    opacity: 1,
    padding: '12px',
    backgroundColor: '#979090',
    borderRadius: '8px',
    ...(isModal && {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: 1000,
      maxWidth: '600px',
      maxHeight: '80vh',
      overflowY: 'auto',
      boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
      minWidth: '400px'
    }),
    ...style
  };

  return (
    <div ref={containerRef} className={className} style={containerStyles}>
      {/* Modal Header */}
      {isModal && showTitle && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
          paddingBottom: '12px',
          borderBottom: '1px solid #260000'
        }}>
          <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>Universe Management</h2>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '1.5rem',
                cursor: 'pointer',
                color: '#260000',
                padding: '0',
                width: '24px',
                height: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ×
            </button>
          )}
        </div>
      )}

      {/* Regular Header */}
      {!isModal && showTitle && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '4px' }}>Universes</div>
          <div style={{ fontSize: '0.8rem', color: '#666' }}>Manage your knowledge spaces</div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div style={{
          backgroundColor: '#ffebee',
          border: '1px solid #f44336',
          borderRadius: '6px',
          padding: '12px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <XCircle size={16} color="#d32f2f" />
          <span style={{ fontSize: '0.85rem' }}>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              color: '#d32f2f',
              cursor: 'pointer'
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Status Display */}
      {syncStatus && (
        <div style={{
          backgroundColor: syncStatus.type === 'error' ? '#ffebee' : '#e8f5e8',
          border: `1px solid ${syncStatus.type === 'error' ? '#f44336' : '#4caf50'}`,
          borderRadius: '6px',
          padding: '8px 12px',
          marginBottom: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          {syncStatus.type === 'error' ? (
            <XCircle size={14} color="#d32f2f" />
          ) : (
            <CheckCircle size={14} color="#4caf50" />
          )}
          <span style={{ fontSize: '0.8rem' }}>{syncStatus.status}</span>
        </div>
      )}

      {/* Add Universe Card */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px',
        backgroundColor: '#bdb5b5',
        border: '2px dashed #979090',
        borderRadius: '6px',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        marginBottom: '8px'
      }}
      onClick={handleCreateUniverse}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = '#979090';
        e.currentTarget.style.borderColor = '#260000';
        e.currentTarget.style.borderStyle = 'solid';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = '#bdb5b5';
        e.currentTarget.style.borderColor = '#979090';
        e.currentTarget.style.borderStyle = 'dashed';
      }}
      >
        <Plus size={20} color="#260000" />
        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#260000' }}>
          Add Universe
        </div>
      </div>

      {/* Universe Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {universeCards.map(({ universe, displayName }) => (
          <div key={universe.slug} style={{
            background: '#bdb5b5',
            border: universe.slug === activeUniverseSlug ? '2px solid #7A0000' : '1px solid #260000',
            borderRadius: '6px',
            padding: '10px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                  {displayName}
                </div>
                {universe.slug === activeUniverseSlug && (
                  <div style={{ fontSize: '0.75rem', color: '#7A0000', fontWeight: 600, padding: '2px 6px', backgroundColor: 'rgba(122,0,0,0.1)', borderRadius: '10px' }}>ACTIVE</div>
                )}
                {/* Node count display */}
                {universe.metadata?.nodeCount > 0 && (
                  <div style={{ fontSize: '0.7rem', color: '#666', fontWeight: 500, padding: '2px 5px', backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: '8px' }}>
                    {universe.metadata.nodeCount} node{universe.metadata.nodeCount !== 1 ? 's' : ''}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                {universe.slug !== activeUniverseSlug && (
                  <button
                    onClick={() => handleSwitchUniverse(universe.slug)}
                    style={{
                      padding: '4px 8px',
                      backgroundColor: 'transparent',
                      color: '#260000',
                      border: '1px solid #260000',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      fontWeight: 'bold'
                    }}
                  >
                    Switch To
                  </button>
                )}
                <button
                  onClick={() => handleDeleteUniverse(universe.slug)}
                  disabled={universeCards.length <= 1}
                  style={{
                    padding: '4px',
                    backgroundColor: 'transparent',
                    color: universeCards.length <= 1 ? '#999' : '#d32f2f',
                    border: `1px solid ${universeCards.length <= 1 ? '#999' : '#d32f2f'}`,
                    borderRadius: '4px',
                    cursor: universeCards.length <= 1 ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: universeCards.length <= 1 ? 0.5 : 1
                  }}
                  title="Delete universe"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            {/* Universe Details (only show for active universe) */}
            {universe.slug === activeUniverseSlug && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: isSlim ? '8px' : '10px', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #979090' }}>
                {/* Name and Stats */}
                <div style={{ display: 'flex', flexDirection: isSlim ? 'column' : 'row', gap: isSlim ? '8px' : '12px' }}>
                  <div style={{ flex: isSlim ? '1' : '2' }}>
                    <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '4px' }}>Name</div>
                    <input
                      value={universe.name || ''}
                      onChange={(e) => handleRenameUniverse(universe.slug, e.target.value)}
                      onBlur={(e) => handleRenameUniverse(universe.slug, e.target.value)}
                      style={{
                        fontSize: '0.85rem',
                        padding: '5px 7px',
                        borderRadius: '4px',
                        width: '100%',
                        background: '#fff',
                        border: '1px solid #ddd',
                        color: '#333'
                      }}
                    />
                  </div>
                  {/* Universe Stats */}
                  <div style={{ flex: '1', minWidth: isSlim ? 'auto' : '120px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '4px' }}>Statistics</div>
                    <div style={{ display: 'flex', gap: '8px', fontSize: '0.75rem', color: '#666' }}>
                      <span>{universe.metadata?.nodeCount || 0} nodes</span>
                      {universe.metadata?.lastOpened && (
                        <>
                          <span>•</span>
                          <span title={new Date(universe.metadata.lastOpened).toLocaleString()}>
                            opened {new Date(universe.metadata.lastOpened).toLocaleDateString()}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Repository summary */}
                <div style={{ marginTop: isSlim ? '8px' : '10px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '4px' }}>Repository</div>
                  {universe?.gitRepo?.linkedRepo ? (
                    <div style={{
                      backgroundColor: '#efe9e9',
                      border: universe.gitRepo?.enabled ? '1px solid #260000' : '1px dashed #7A0000',
                      borderRadius: '6px',
                      padding: isSlim ? '6px' : '8px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: '#260000', fontSize: '0.85rem' }}>
                          <Github size={14} />
                          <span>@{universe.gitRepo.linkedRepo.user}/{universe.gitRepo.linkedRepo.repo}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.65rem', fontWeight: 600 }}>
                          <span style={{ padding: '2px 6px', borderRadius: '10px', backgroundColor: universe.gitRepo?.enabled ? '#7A0000' : '#ff9800', color: '#fff' }}>
                            {universe.gitRepo?.enabled ? 'Sync Enabled' : 'Sync Disabled'}
                          </span>
                          {universe.gitRepo?.linkedRepo?.private ? (
                            <span style={{ padding: '2px 6px', borderRadius: '10px', backgroundColor: '#4b5563', color: '#fff' }}>Private</span>
                          ) : (
                            <span style={{ padding: '2px 6px', borderRadius: '10px', backgroundColor: '#2563eb', color: '#fff' }}>Public</span>
                          )}
                        </div>
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#444', marginTop: '6px', fontFamily: 'monospace' }}>
                        {universe.gitRepo?.universeFolder || `universes/${universe.slug || 'universe'}`}/{universe.slug || 'universe'}.redstring
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap' }}>
                        <div style={{ fontSize: '0.65rem', color: '#260000', fontWeight: 600 }}>
                          Mode: {universe.sourceOfTruth === 'git' ? 'Git' : 'Local fallback'}
                        </div>
                        {universe.gitRepo?.linkedRepo?.type === 'github' && (
                          <button
                            onClick={() => {
                              const { user, repo } = universe.gitRepo.linkedRepo;
                              const url = `https://github.com/${user}/${repo}`;
                              window.open(url, '_blank', 'noopener');
                            }}
                            style={{
                              padding: '4px 8px',
                              backgroundColor: '#260000',
                              color: '#bdb5b5',
                              border: 'none',
                              borderRadius: '4px',
                              fontSize: '0.7rem',
                              cursor: 'pointer',
                              fontWeight: 'bold'
                            }}
                          >
                            Open Repo
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      padding: isSlim ? '6px' : '8px',
                      borderRadius: '6px',
                      border: '1px dashed #979090',
                      color: '#666',
                      fontSize: '0.75rem'
                    }}>
                      No repository linked
                    </div>
                  )}
                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: isSlim ? 'column' : 'row', gap: '8px', alignItems: isSlim ? 'stretch' : 'center' }}>
                    <div style={{ flex: '1', minWidth: '220px' }}>
                      <RepositoryDropdown
                        selectedRepository={universe.gitRepo?.linkedRepo ? {
                          name: universe.gitRepo.linkedRepo.repo,
                          owner: { login: universe.gitRepo.linkedRepo.user },
                          full_name: `${universe.gitRepo.linkedRepo.user}/${universe.gitRepo.linkedRepo.repo}`,
                          private: universe.gitRepo.linkedRepo.private
                        } : null}
                        onSelectRepository={(repo) => handleLinkRepository(universe, repo)}
                        placeholder={canSelectRepositories ? 'Select repository' : 'Connect GitHub to select'}
                        disabled={!canSelectRepositories || isRepoLoading}
                        repositories={userRepositories}
                      />
                    </div>
                    {isRepoLoading && (
                      <div style={{ fontSize: '0.65rem', color: '#666' }}>Loading repositories…</div>
                    )}
                    {universe.gitRepo?.linkedRepo && (
                      <button
                        onClick={() => handleUnlinkRepository(universe)}
                        style={{
                          padding: '4px 8px',
                          backgroundColor: 'transparent',
                          color: '#d32f2f',
                          border: '1px solid #d32f2f',
                          borderRadius: '4px',
                          fontSize: '0.7rem',
                          cursor: 'pointer',
                          fontWeight: 'bold'
                        }}
                      >
                        Unlink
                      </button>
                    )}
                  </div>
                </div>

                {/* Source of Truth Selection */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: isSlim ? '6px' : '8px' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '4px' }}>Storage Mode</div>
                    <div style={{ display: 'flex', gap: isSlim ? '4px' : '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                      {deviceInfo.supportsFileSystemAPI ? (
                        <button
                          onClick={() => handleSetSourceOfTruth('local')}
                          style={{
                            padding: isSlim ? '4px 8px' : '6px 10px',
                            backgroundColor: activeUniverse?.sourceOfTruth === 'local' ? '#260000' : 'transparent',
                            color: activeUniverse?.sourceOfTruth === 'local' ? '#bdb5b5' : '#260000',
                            border: '1px solid #260000',
                            borderRadius: '4px',
                            fontSize: '0.7rem',
                            cursor: 'pointer',
                            fontWeight: 'bold'
                          }}
                        >
                          Local File
                        </button>
                      ) : (
                        <div style={{
                          padding: isSlim ? '4px 8px' : '6px 10px',
                          backgroundColor: '#f0f0f0',
                          color: '#999',
                          border: '1px solid #ccc',
                          borderRadius: '4px',
                          fontSize: '0.7rem',
                          fontWeight: 'bold'
                        }}>
                          Local File (Unavailable)
                        </div>
                      )}
                      <button
                        onClick={() => handleSetSourceOfTruth('git')}
                        style={{
                          padding: isSlim ? '4px 8px' : '6px 10px',
                          backgroundColor: activeUniverse?.sourceOfTruth === 'git' ? '#260000' : 'transparent',
                          color: activeUniverse?.sourceOfTruth === 'git' ? '#bdb5b5' : '#260000',
                          border: '1px solid #260000',
                          borderRadius: '4px',
                          fontSize: '0.7rem',
                          cursor: 'pointer',
                          fontWeight: 'bold'
                        }}
                      >
                        Git Repository
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            padding: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
          }}>
            <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite' }} />
            <span>Loading...</span>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default UniverseManagementPanel;
