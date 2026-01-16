import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, ChevronDown, Github, Upload, Download, X, Edit, Star, Save, Activity, Link, FileText, ArrowRightLeft, FolderOpen, Folder } from 'lucide-react';
import SectionCard from './shared/SectionCard.jsx';
import PanelIconButton from '../shared/PanelIconButton.jsx';

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
    transition: 'all 0.15s',
    outline: 'none',
    boxShadow: 'none'
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

function formatWhen(timestamp) {
  if (!timestamp) return 'Never';
  try {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    const now = Date.now();
    const diff = now - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  } catch {
    return 'Unknown';
  }
}

import { saveWorkspaceHandle, getWorkspaceHandle, clearWorkspaceHandle } from '../../services/workspaceFolderService.js';

const UniversesList = ({
  universes = [],
  activeUniverseSlug,
  isLoading = false,
  syncStatusMap = {},
  onCreateUniverse,
  onSwitchUniverse,
  onDeleteUniverse,
  onLinkRepo,
  onLinkLocalFile,
  onCreateLocalFile,
  onDownloadLocalFile,
  onDownloadRepoFile,
  onRemoveLocalFile,
  onRemoveRepoSource,
  onEditRepoSource,
  onSetMainRepoSource,
  onSaveRepoSource,
  onSetPrimarySource,
  onCreateUniverseFromFile,
  onLoadFromLocal,
  onLoadFromRepo,
  onGrantLocalPermission,
  isSlim = false
}) => {
  // No collapsing - active universe is always expanded, others show compact view
  const [showLoadMenu, setShowLoadMenu] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showLocalFileMenu, setShowLocalFileMenu] = useState(null); // Track which universe's menu is open
  const [isHeaderSlim, setIsHeaderSlim] = useState(false); // Track if header should stack at < 400px
  const [workspaceFolder, setWorkspaceFolder] = useState(() => {
    try {
      return localStorage.getItem('redstring_workspace_folder_name') || null;
    } catch {
      return null;
    }
  });
  const [workspaceFolderHandle, setWorkspaceFolderHandle] = useState(null);
  const loadMenuRef = useRef(null);
  const newMenuRef = useRef(null);
  const localFileMenuRef = useRef(null);
  const containerRef = useRef(null);

  // Try to restore workspace folder handle from IndexedDB on mount
  useEffect(() => {
    (async () => {
      try {
        const handle = await getWorkspaceHandle();
        if (handle) {
          setWorkspaceFolderHandle(handle);
          setWorkspaceFolder(handle.name);
        }
      } catch (e) {
        console.warn('[UniversesList] Failed to restore workspace folder handle:', e);
      }
    })();
  }, []);

  // Track container width for responsive header layout
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect?.width || el.clientWidth || 0;
        setIsHeaderSlim(width < 400);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (loadMenuRef.current && !loadMenuRef.current.contains(event.target)) {
        setShowLoadMenu(false);
      }
      if (newMenuRef.current && !newMenuRef.current.contains(event.target)) {
        setShowNewMenu(false);
      }
      if (localFileMenuRef.current && !localFileMenuRef.current.contains(event.target)) {
        setShowLocalFileMenu(null);
      }
    };

    if (showLoadMenu || showNewMenu || showLocalFileMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showLoadMenu, showNewMenu, showLocalFileMenu]);

  // Workspace folder picker
  const handlePickWorkspaceFolder = async () => {
    if (!('showDirectoryPicker' in window)) {
      alert('Directory picker is not supported in this browser.');
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      setWorkspaceFolderHandle(handle);
      setWorkspaceFolder(handle.name);
      await saveWorkspaceHandle(handle);
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('[UniversesList] Failed to pick workspace folder:', e);
      }
    }
  };

  const handleClearWorkspaceFolder = async () => {
    setWorkspaceFolderHandle(null);
    setWorkspaceFolder(null);
    await clearWorkspaceHandle();
  };

  const triggerLocalFilePicker = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.redstring';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (file && onLoadFromLocal) {
        onLoadFromLocal(file);
      }
    };
    input.click();
  };

  const handleLoadFromLocalClick = () => {
    setShowLoadMenu(false);
    triggerLocalFilePicker();
  };

  const handleLoadFromRepoClick = () => {
    setShowLoadMenu(false);
    if (onLoadFromRepo) {
      onLoadFromRepo();
    }
  };

  const handleNewEmptyClick = () => {
    setShowNewMenu(false);
    if (onCreateUniverse) {
      onCreateUniverse();
    }
  };

  const handleNewFromFileClick = () => {
    setShowNewMenu(false);
    if (onCreateUniverseFromFile) {
      onCreateUniverseFromFile();
      return;
    }
    triggerLocalFilePicker();
  };

  const handleNewFromRepoClick = () => {
    setShowNewMenu(false);
    if (onLoadFromRepo) {
      onLoadFromRepo();
    }
  };

  return (
    <div ref={containerRef}>
      <SectionCard
        title="Universes"
        subtitle="Manage your knowledge spaces"
        isSlim={isHeaderSlim}
        actions={
          <div style={{ display: 'flex', gap: 6 }}>
            <div ref={loadMenuRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setShowLoadMenu(!showLoadMenu)}
                style={buttonStyle('outline')}
              >
                <Download size={14} /> Load <ChevronDown size={12} />
              </button>
              {showLoadMenu && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 4,
                  backgroundColor: '#bdb5b5',
                  border: '1px solid #260000',
                  borderRadius: 6,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  zIndex: 1000,
                  minWidth: 180
                }}>
                  <button
                    onClick={handleLoadFromLocalClick}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      border: 'none',
                      background: 'none',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#260000',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <FileText size={12} /> From Local File
                  </button>
                  <button
                    onClick={handleLoadFromRepoClick}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      border: 'none',
                      background: 'none',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#260000',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <Github size={12} /> From Repository
                  </button>
                </div>
              )}
            </div>
            <div ref={newMenuRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setShowNewMenu(!showNewMenu)}
                style={{ ...buttonStyle('solid'), color: '#bdb5b5' }}
              >
                <Plus size={14} /> New <ChevronDown size={12} />
              </button>
              {showNewMenu && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 4,
                  backgroundColor: '#bdb5b5',
                  border: '1px solid #260000',
                  borderRadius: 6,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  zIndex: 1000,
                  minWidth: 180
                }}>
                  <button
                    onClick={handleNewEmptyClick}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      border: 'none',
                      background: 'none',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#260000',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <Plus size={12} /> Empty Universe
                  </button>
                  <button
                    onClick={handleNewFromFileClick}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      border: 'none',
                      background: 'none',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#260000',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <FileText size={12} /> From File
                  </button>
                  <button
                    onClick={handleNewFromRepoClick}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      border: 'none',
                      background: 'none',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#260000',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <Github size={12} /> From Repository
                  </button>
                </div>
              )}
            </div>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Workspace Folder Section */}
          <div style={{
            padding: '10px 12px',
            backgroundColor: '#cfc6c6',
            borderRadius: 6,
            border: workspaceFolder ? '2px solid #7A0000' : '2px dashed #979090',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              {workspaceFolder ? (
                <FolderOpen size={18} color="#7A0000" />
              ) : (
                <Folder size={18} color="#666" />
              )}
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#260000' }}>
                  Workspace Folder
                </span>
                <span style={{
                  fontSize: '0.65rem',
                  color: workspaceFolder ? '#444' : '#888',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {workspaceFolder || 'Not linked — files may lose permissions on reload'}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              <PanelIconButton
                icon={workspaceFolder ? FolderOpen : Upload}
                size={18}
                onClick={handlePickWorkspaceFolder}
                title={workspaceFolder ? 'Change workspace folder' : 'Choose workspace folder'}
              />
              {workspaceFolder && (
                <PanelIconButton
                  icon={X}
                  size={16}
                  onClick={handleClearWorkspaceFolder}
                  title="Unlink workspace folder"
                />
              )}
            </div>
          </div>

          {isLoading ? (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '40px 0',
              color: '#666',
              gap: 12,
              background: 'rgba(0,0,0,0.02)',
              borderRadius: 8
            }}>
              <div style={{
                width: 16,
                height: 16,
                border: '2px solid #8B0000',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
              <span style={{ fontSize: '0.9rem' }}>Loading universes...</span>
              <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
            </div>
          ) : universes.length === 0 ? (
            <div style={{
              padding: '30px 20px',
              textAlign: 'center',
              color: '#8B0000',
              fontSize: '0.9rem',
              background: 'rgba(139, 0, 0, 0.05)',
              borderRadius: 8,
              border: '1px dashed rgba(139, 0, 0, 0.2)',
              fontStyle: 'italic'
            }}>
              No universes found. Create one to get started.
            </div>
          ) : (
            universes.map((universe) => {
              const isActive = universe.slug === activeUniverseSlug;
              const resolvedSource = universe.sourceOfTruth || universe.raw?.sourceOfTruth || universe.storage?.primary?.type || null;
              const nodeCount = universe.nodeCount || universe.raw?.nodeCount || 0;
              const connectionCount = universe.connectionCount || universe.raw?.connectionCount || 0;
              const graphCount = universe.graphCount || universe.raw?.graphCount || 0;

              return (
                <div
                  key={universe.slug}
                  style={{
                    border: isActive ? '2px solid #7A0000' : '1px solid #260000',
                    borderRadius: 8,
                    backgroundColor: '#bdb5b5',
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10
                  }}
                >
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontWeight: 600, color: '#260000' }}>{universe.name}</span>
                          {isActive && (
                            <span style={{
                              fontSize: '0.6rem',
                              padding: '2px 6px',
                              borderRadius: 10,
                              backgroundColor: '#7A0000',
                              color: '#ffffff',
                              fontWeight: 700
                            }}>
                              ACTIVE
                            </span>
                          )}
                        </div>
                        <div style={{
                          fontSize: isSlim ? '0.65rem' : '0.7rem',
                          color: '#555',
                          marginTop: 2,
                          display: 'flex',
                          gap: isSlim ? 6 : 8,
                          flexWrap: 'wrap'
                        }}>
                          <span>{nodeCount} things</span>
                          <span>·</span>
                          <span>{connectionCount} connections</span>
                          {!isSlim && (
                            <>
                              <span>·</span>
                              <span>{graphCount} webs</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div style={{
                      display: 'flex',
                      gap: isSlim ? 4 : 6,
                      alignItems: 'center',
                      flexShrink: 0
                    }}>
                      {!isActive && (
                        <PanelIconButton
                          icon={ArrowRightLeft}
                          size={isSlim ? 18 : 20}
                          onClick={() => onSwitchUniverse(universe.slug)}
                          title="Switch to this universe"
                        />
                      )}
                      {universes.length > 1 && (
                        <PanelIconButton
                          icon={Trash2}
                          size={isSlim ? 18 : 20}
                          onClick={() => onDeleteUniverse(universe.slug, universe.name)}
                          title="Delete universe"
                        />
                      )}
                    </div>
                  </div>

                  {/* Expanded Content - Only for Active Universe */}
                  {isActive && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingLeft: 24 }}>
                      {/* Storage Slots */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#260000' }}>
                          Storage
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {/* Repository Slot */}
                          {universe.raw?.gitRepo?.linkedRepo ? (
                            <div
                              style={{
                                padding: 8,
                                backgroundColor: '#cfc6c6',
                                borderRadius: 6,
                                border: `2px solid ${resolvedSource === 'git' ? '#7A0000' : '#979090'}`,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 6,
                                maxWidth: '100%',
                                overflow: 'hidden'
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <Github size={14} />
                                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#260000' }}>
                                    @{universe.raw.gitRepo.linkedRepo.user}/{universe.raw.gitRepo.linkedRepo.repo}
                                  </span>
                                  {/* Source-of-truth badge removed; button below handles status */}
                                </div>
                                <div style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: isSlim ? 2 : 4,
                                  flexShrink: 0
                                }}>
                                  {onDownloadRepoFile && (
                                    <PanelIconButton
                                      icon={Download}
                                      size={isSlim ? 16 : 18}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onDownloadRepoFile(universe.slug);
                                      }}
                                      title="Download latest from Git repository"
                                    />
                                  )}
                                  <PanelIconButton
                                    icon={X}
                                    size={isSlim ? 16 : 18}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (onRemoveRepoSource && universe.raw.gitRepo?.linkedRepo) {
                                        onRemoveRepoSource(universe.slug, {
                                          user: universe.raw.gitRepo.linkedRepo.user,
                                          repo: universe.raw.gitRepo.linkedRepo.repo
                                        });
                                      }
                                    }}
                                    title="Remove repository"
                                  />
                                </div>
                              </div>

                              {/* Git Status Information */}
                              {(() => {
                                const syncStatus = syncStatusMap[universe.slug];
                                const fileName = `universes/${universe.slug}/${universe.slug}.redstring`;
                                const statusText = syncStatus?.status || 'unknown';
                                const lastSync = syncStatus?.lastSync ? formatWhen(syncStatus.lastSync) : 'Never';
                                const hasError = syncStatus?.error;
                                const isLoading = syncStatus?.isLoading || syncStatus?.isSyncing;

                                return (
                                  <div style={{
                                    fontSize: '0.65rem',
                                    color: '#444',
                                    marginTop: '4px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 2
                                  }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <span style={{ fontWeight: 600, color: '#260000' }}>File:</span>
                                      <span style={{ wordBreak: 'break-word' }}>
                                        {fileName}
                                      </span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <span style={{ fontWeight: 600, color: '#260000' }}>Status:</span>
                                      <span style={{
                                        color: hasError ? '#d32f2f' : isLoading ? '#ef6c00' : statusText === 'synced' ? '#7A0000' : '#666',
                                        fontWeight: 500
                                      }}>
                                        {isLoading ? '⟳ Loading...' : hasError ? '⚠ Error' : statusText}
                                      </span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <span style={{ fontWeight: 600, color: '#260000' }}>Last saved:</span>
                                      <span style={{ color: '#666' }}>{lastSync}</span>
                                    </div>
                                    {hasError && (
                                      <div style={{
                                        marginTop: 4,
                                        padding: '3px 6px',
                                        backgroundColor: '#ffebee',
                                        borderRadius: 3,
                                        border: '1px solid #ffcdd2'
                                      }}>
                                        <span style={{ color: '#c62828', fontSize: '0.6rem' }}>
                                          {syncStatus.error}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}

                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {(() => {
                                  const isSourceOfTruth = resolvedSource === 'git';
                                  const hasOtherStorage = !!(universe.raw?.localFile?.enabled);
                                  const canToggle = hasOtherStorage;

                                  return onSetPrimarySource && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (canToggle) {
                                          onSetPrimarySource(universe.slug, 'git');
                                        }
                                      }}
                                      style={{
                                        fontSize: '0.65rem',
                                        padding: '2px 6px',
                                        borderRadius: 6,
                                        cursor: canToggle ? 'pointer' : 'default',
                                        fontWeight: 600,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        border: '1px solid #7A0000',
                                        backgroundColor: isSourceOfTruth ? '#7A0000' : 'transparent',
                                        color: isSourceOfTruth ? '#bdb5b5' : '#7A0000',
                                        opacity: canToggle ? 1 : 0.85
                                      }}
                                      title={!canToggle ? 'Only storage option (must remain source of truth)' : isSourceOfTruth ? 'Currently source of truth' : 'Click to make source of truth'}
                                    >
                                      <Star size={10} fill={isSourceOfTruth ? '#bdb5b5' : 'none'} />
                                      {isSourceOfTruth ? 'Source of Truth' : 'Not Source of Truth'}
                                    </button>
                                  );
                                })()}
                                {onSaveRepoSource && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onSaveRepoSource(universe.slug);
                                    }}
                                    style={{
                                      ...buttonStyle('outline'),
                                      fontSize: '0.65rem',
                                      padding: '2px 6px',
                                      color: '#7A0000',
                                      borderColor: '#7A0000'
                                    }}
                                    title="Manual save"
                                  >
                                    <Save size={10} />
                                    Save
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div style={{
                              padding: 12,
                              backgroundColor: 'transparent',
                              borderRadius: 6,
                              border: '2px dashed #979090',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}>
                              <button
                                onClick={() => onLinkRepo && onLinkRepo(universe.slug)}
                                style={{
                                  ...buttonStyle('outline'),
                                  fontSize: '0.7rem',
                                  color: '#666',
                                  borderColor: '#979090'
                                }}
                              >
                                <Plus size={12} />
                                Add Repository
                              </button>
                            </div>
                          )}

                          {/* Local File Slot */}
                          {universe.raw?.localFile?.enabled ? (
                            <div
                              style={{
                                padding: 8,
                                backgroundColor: '#cfc6c6',
                                borderRadius: 6,
                                border: `2px solid ${resolvedSource === 'local' ? '#7A0000' : '#979090'}`,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 6,
                                maxWidth: '100%',
                                overflow: 'hidden'
                              }}
                            >
                              {(() => {
                                const localFile = universe.raw?.localFile || {};
                                const lastSavedLabel = localFile.lastSaved
                                  ? formatWhen(localFile.lastSaved)
                                  : 'Never';
                                const lastSavedColor = localFile.lastSaved ? '#666' : '#999';

                                return (
                                  <>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <Save size={14} />
                                        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#260000' }}>
                                          Local File
                                        </span>
                                        {/* Source-of-truth badge removed; button below handles status */}
                                      </div>
                                      <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: isSlim ? 2 : 4,
                                        flexShrink: 0
                                      }}>
                                        {onDownloadLocalFile && (
                                          <PanelIconButton
                                            icon={Download}
                                            size={isSlim ? 16 : 18}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onDownloadLocalFile(universe.slug);
                                            }}
                                            title="Download/export local file"
                                          />
                                        )}
                                        {onRemoveLocalFile && (
                                          <PanelIconButton
                                            icon={X}
                                            size={isSlim ? 16 : 18}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onRemoveLocalFile(universe.slug);
                                            }}
                                            title="Unlink local file"
                                          />
                                        )}
                                      </div>
                                    </div>

                                    <div style={{
                                      fontSize: '0.65rem',
                                      color: '#444',
                                      marginTop: '4px',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: 2
                                    }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <span style={{ fontWeight: 600, color: '#260000' }}>File:</span>
                                        <span style={{ wordBreak: 'break-word' }}>
                                          {localFile.displayPath || localFile.path || localFile.lastFilePath || localFile.suggestedPath || `${universe.slug}.redstring`}
                                        </span>
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <span style={{ fontWeight: 600, color: '#260000' }}>Last saved:</span>
                                        <span style={{ color: lastSavedColor }}>
                                          {lastSavedLabel}
                                        </span>
                                      </div>
                                    </div>

                                    {localFile.fileHandleStatus === 'needs_reconnect' && (
                                      <div
                                        style={{
                                          marginTop: 6,
                                          padding: '6px 8px',
                                          borderRadius: 6,
                                          backgroundColor: 'rgba(122,0,0,0.12)',
                                          border: '1px solid rgba(122,0,0,0.4)',
                                          color: '#5a0000',
                                          fontSize: '0.65rem',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          gap: 8,
                                          flexWrap: 'wrap'
                                        }}
                                      >
                                        <span>Reconnect this file to continue saving locally.</span>
                                        {onLinkLocalFile && (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onLinkLocalFile(universe.slug);
                                            }}
                                            style={{
                                              ...buttonStyle('outline'),
                                              fontSize: '0.62rem',
                                              padding: '2px 6px',
                                              borderColor: '#7A0000',
                                              color: '#7A0000'
                                            }}
                                          >
                                            Reconnect
                                          </button>
                                        )}
                                      </div>
                                    )}
                                    {localFile.fileHandleStatus === 'permission_needed' && (
                                      <div
                                        style={{
                                          marginTop: 6,
                                          padding: '6px 8px',
                                          borderRadius: 6,
                                          backgroundColor: 'rgba(237,170,0,0.14)',
                                          border: '1px solid rgba(237,170,0,0.4)',
                                          color: '#5a3b00',
                                          fontSize: '0.65rem',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          gap: 8,
                                          flexWrap: 'wrap'
                                        }}
                                      >
                                        <span>
                                          {localFile.reconnectMessage || 'Grant file access permission to resume auto-saving.'}
                                        </span>
                                        {onGrantLocalPermission && (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onGrantLocalPermission(universe.slug);
                                            }}
                                            style={{
                                              ...buttonStyle('outline'),
                                              fontSize: '0.62rem',
                                              padding: '2px 6px',
                                              borderColor: '#b85e00',
                                              color: '#b85e00'
                                            }}
                                          >
                                            Grant Access
                                          </button>
                                        )}
                                      </div>
                                    )}

                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                      {(() => {
                                        const isSourceOfTruth = resolvedSource === 'local';
                                        const hasOtherStorage = !!(universe.raw?.gitRepo?.linkedRepo);
                                        const canToggle = hasOtherStorage;

                                        return onSetPrimarySource && (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (canToggle) {
                                                onSetPrimarySource(universe.slug, 'local');
                                              }
                                            }}
                                            style={{
                                              fontSize: '0.65rem',
                                              padding: '2px 6px',
                                              borderRadius: 6,
                                              cursor: canToggle ? 'pointer' : 'default',
                                              fontWeight: 600,
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: 4,
                                              border: '1px solid #7A0000',
                                              backgroundColor: isSourceOfTruth ? '#7A0000' : 'transparent',
                                              color: isSourceOfTruth ? '#bdb5b5' : '#7A0000',
                                              opacity: canToggle ? 1 : 0.85
                                            }}
                                            title={!canToggle ? 'Only storage option (must remain source of truth)' : isSourceOfTruth ? 'Currently source of truth' : 'Click to make source of truth'}
                                          >
                                            <Star size={10} fill={isSourceOfTruth ? '#bdb5b5' : 'none'} />
                                            {isSourceOfTruth ? 'Source of Truth' : 'Not Source of Truth'}
                                          </button>
                                        );
                                      })()}
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                          ) : (
                            <div
                              ref={showLocalFileMenu === universe.slug ? localFileMenuRef : null}
                              style={{
                                padding: 12,
                                backgroundColor: 'transparent',
                                borderRadius: 6,
                                border: '2px dashed #979090',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                position: 'relative'
                              }}
                            >
                              <button
                                onClick={() => setShowLocalFileMenu(showLocalFileMenu === universe.slug ? null : universe.slug)}
                                style={{
                                  ...buttonStyle('outline'),
                                  fontSize: '0.7rem',
                                  color: '#666',
                                  borderColor: '#979090'
                                }}
                              >
                                <Plus size={12} />
                                Add Local File
                                <ChevronDown size={10} />
                              </button>

                              {showLocalFileMenu === universe.slug && (
                                <div style={{
                                  position: 'absolute',
                                  top: '100%',
                                  left: 0,
                                  marginTop: 4,
                                  backgroundColor: '#bdb5b5',
                                  border: '1px solid #260000',
                                  borderRadius: 6,
                                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                  zIndex: 1000,
                                  minWidth: 160
                                }}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShowLocalFileMenu(null);
                                      // Create new file - this will trigger save dialog and link file handle
                                      if (onCreateLocalFile) {
                                        onCreateLocalFile(universe.slug);
                                      }
                                    }}
                                    style={{
                                      width: '100%',
                                      padding: '8px 12px',
                                      border: 'none',
                                      background: 'none',
                                      textAlign: 'left',
                                      cursor: 'pointer',
                                      fontSize: '0.75rem',
                                      fontWeight: 600,
                                      color: '#260000',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                  >
                                    <FileText size={12} /> Create New File
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShowLocalFileMenu(null);
                                      // Link existing file - trigger file picker
                                      if (onLinkLocalFile) {
                                        onLinkLocalFile(universe.slug);
                                      }
                                    }}
                                    style={{
                                      width: '100%',
                                      padding: '8px 12px',
                                      border: 'none',
                                      background: 'none',
                                      textAlign: 'left',
                                      cursor: 'pointer',
                                      fontSize: '0.75rem',
                                      fontWeight: 600,
                                      color: '#260000',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                  >
                                    <Link size={12} /> Link Existing File
                                  </button>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Browser Storage Warning */}
                          {(!universe.raw?.gitRepo?.linkedRepo && !universe.raw?.localFile?.enabled) && (
                            <div style={{
                              padding: 8,
                              backgroundColor: 'rgba(122,0,0,0.08)',
                              borderRadius: 6,
                              border: '1px solid #7A0000',
                              fontSize: '0.7rem',
                              color: '#7A0000',
                              textAlign: 'center',
                              fontWeight: 500
                            }}>
                              ⚠ Data stored in browser only. Link long-term storage to save your data reliably.
                            </div>
                          )}
                        </div>
                      </div>

                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </SectionCard>
    </div>
  );
};

export default UniversesList;
