import React, { useState, useEffect, useRef } from 'react';
import { Plus, ChevronDown, Github, Upload, Download, X, Edit, Star, Save, Activity, Link, FileText, ArrowRightLeft, FolderOpen, Folder, RotateCcw, Key } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';

import SectionCard from './shared/SectionCard.jsx';
import PanelIconButton from '../shared/PanelIconButton.jsx';


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

import { saveWorkspaceHandle, getWorkspaceHandle, clearWorkspaceHandle, checkWorkspacePermission, requestWorkspacePermission } from '../../services/workspaceFolderService.js';

const UniversesList = ({
  universes = [],
  activeUniverseSlug,
  isLoading = false,
  syncStatusMap = {},
  liveMetrics,
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
  onSwapLocalFile,
  onWorkspacePermissionGranted,
  isSlim = false
}) => {
  const theme = useTheme();
  // No collapsing - active universe is always expanded, others show compact view

  const [showLoadMenu, setShowLoadMenu] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showLocalFileMenu, setShowLocalFileMenu] = useState(null); // Track which universe's menu is open
  const [isHeaderSlim, setIsHeaderSlim] = useState(false); // Track if header should stack at < 480px
  const [isVerySlim, setIsVerySlim] = useState(false); // Track if container is < 320px for aggressive space-saving
  const [workspaceFolder, setWorkspaceFolder] = useState(() => {
    try {
      return localStorage.getItem('redstring_workspace_folder_name') || null;
    } catch {
      return null;
    }
  });
  const [workspaceFolderHandle, setWorkspaceFolderHandle] = useState(null);
  const [workspaceNeedsPermission, setWorkspaceNeedsPermission] = useState(false);
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
          // Extract name safely: string path (Electron) vs DirectoryHandle (web)
          const name = typeof handle === 'string'
            ? handle.split(/[/\\]/).pop()
            : handle.name;
          if (name) setWorkspaceFolder(name);

          // Check if permission was lost after page refresh (web only — Electron always returns 'granted')
          const permState = await checkWorkspacePermission();
          if (permState && permState !== 'granted') {
            setWorkspaceNeedsPermission(true);
          }
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
        setIsHeaderSlim(width < 480);
        setIsVerySlim(width < 320);
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
    try {
      // Electron: use native IPC folder picker (returns a path string)
      if (window.electron?.fileSystem?.pickFolder) {
        const folderPath = await window.electron.fileSystem.pickFolder();
        if (!folderPath) return; // user cancelled
        const folderName = folderPath.split(/[/\\]/).pop();
        setWorkspaceFolderHandle(folderPath);
        setWorkspaceFolder(folderName);
        setWorkspaceNeedsPermission(false);
        await saveWorkspaceHandle(folderPath);
        return;
      }

      // Web: use File System Access API
      if (!('showDirectoryPicker' in window)) {
        alert('Directory picker is not supported in this browser.');
        return;
      }
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      setWorkspaceFolderHandle(handle);
      setWorkspaceFolder(handle.name);
      setWorkspaceNeedsPermission(false);
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
    setWorkspaceNeedsPermission(false);
    await clearWorkspaceHandle();
  };

  const handleRegrantWorkspacePermission = async () => {
    try {
      const result = await requestWorkspacePermission();
      if (result === 'granted') {
        setWorkspaceNeedsPermission(false);
        onWorkspacePermissionGranted?.();
      }
    } catch (e) {
      console.error('[UniversesList] Failed to re-grant workspace permission:', e);
    }
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

  // Helper function for responsive sizing
  const getResponsiveValue = (normalValue, slimValue, verySlimValue) => {
    if (isVerySlim) return verySlimValue;
    if (isSlim) return slimValue;
    return normalValue;
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
              <PanelIconButton
                icon={Upload}
                size={isVerySlim ? 16 : 18}
                label={isVerySlim ? null : (
                  <React.Fragment>
                    Load <ChevronDown size={12} style={{ verticalAlign: 'middle', marginBottom: '1px' }} />
                  </React.Fragment>
                )}
                variant="outline"
                style={isVerySlim ? { padding: '5px' } : {}}
                onClick={() => setShowLoadMenu(!showLoadMenu)}
                title={isVerySlim ? "Load" : undefined}
              />
              {showLoadMenu && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 4,
                  backgroundColor: theme.canvas.bg,
                  border: `1px solid ${theme.canvas.border}`,
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
                      color: theme.canvas.textPrimary,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.canvas.hover}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <FileText size={12} /> Load from Local File
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
                      color: theme.canvas.textPrimary,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.canvas.hover}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <Github size={12} /> Load from Repository
                  </button>
                </div>
              )}
            </div>
            <div ref={newMenuRef} style={{ position: 'relative' }}>
              <PanelIconButton
                icon={Plus}
                size={isVerySlim ? 16 : 18}
                label={isVerySlim ? null : (
                  <React.Fragment>
                    New <ChevronDown size={12} style={{ verticalAlign: 'middle', marginBottom: '1px' }} />
                  </React.Fragment>
                )}
                variant="solid"
                style={isVerySlim ? { padding: '5px' } : {}}
                onClick={() => setShowNewMenu(!showNewMenu)}
                title={isVerySlim ? "New" : undefined}
              />
              {showNewMenu && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 4,
                  backgroundColor: theme.canvas.bg,

                  border: `1px solid ${theme.canvas.border}`,
                  borderRadius: 6,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  zIndex: 1000,
                  minWidth: 180
                }}>
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
                      color: theme.canvas.textPrimary,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.canvas.hover}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <FileText size={12} /> New Local File
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
                      color: theme.canvas.textPrimary,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.canvas.hover}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <Github size={12} /> New Repository
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
            padding: isVerySlim ? '8px 10px' : '10px 12px',
            backgroundColor: theme.canvas.bg,
            borderRadius: 6,
            border: `1px solid ${theme.canvas.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              {workspaceFolder ? (
                <FolderOpen size={isVerySlim ? 16 : 18} color={theme.darkMode ? '#CCAAA8' : theme.canvas.brand} />
              ) : (
                <Folder size={isVerySlim ? 16 : 18} color={theme.darkMode ? '#CCAAA8' : theme.canvas.textSecondary} />
              )}
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{
                  fontSize: isVerySlim ? '0.68rem' : '0.72rem',
                  fontWeight: 600,
                  color: theme.canvas.textPrimary
                }}>
                  Workspace Folder
                </span>
                <span style={{
                  fontSize: isVerySlim ? '0.6rem' : '0.65rem',
                  color: workspaceFolder ? theme.canvas.textPrimary : theme.canvas.textSecondary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {workspaceFolder || 'Not linked — files may lose permissions on reload'}
                </span>
              </div>
            </div>
            <div style={{
              display: 'flex',
              gap: isVerySlim ? 2 : 4,
              flexShrink: 0
            }}>
              <PanelIconButton
                icon={workspaceFolder ? FolderOpen : Upload}
                size={isVerySlim ? 14 : 18}
                style={isVerySlim ? { padding: '5px' } : {}}
                onClick={handlePickWorkspaceFolder}
                title={workspaceFolder ? 'Change workspace folder' : 'Choose workspace folder'}
              />
              {workspaceFolder && (
                <PanelIconButton
                  icon={X}
                  size={isVerySlim ? 12 : 16}
                  style={isVerySlim ? { padding: '6px' } : {}}
                  onClick={handleClearWorkspaceFolder}
                  title="Unlink workspace folder"
                />
              )}
            </div>
          </div>

          {workspaceFolder && workspaceNeedsPermission && (
            <div style={{
              padding: isVerySlim ? '6px 10px' : '8px 12px',
              backgroundColor: theme.alert.warning.bg,
              borderRadius: 6,
              border: `1px solid ${theme.alert.warning.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              fontSize: isVerySlim ? '0.62rem' : '0.68rem',
              color: theme.alert.warning.text
            }}>
              <span>Workspace folder access was lost on reload. Click to re-authorize.</span>
              <PanelIconButton
                icon={Key}
                label="Re-grant Access"
                variant="outline"
                size={isVerySlim ? 12 : 14}
                style={{
                  fontSize: '0.62rem',
                  padding: '2px 10px',
                  borderColor: theme.alert.warning.text,
                  color: theme.alert.warning.text,
                  flexShrink: 0
                }}
                onClick={handleRegrantWorkspacePermission}
                title="Re-grant workspace folder access permission"
              />
            </div>
          )}

          {isLoading ? (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '40px 0',
              color: theme.canvas.textSecondary,
              gap: 12,
              background: theme.canvas.inactive,
              borderRadius: 8
            }}>
              <div style={{
                width: 16,
                height: 16,
                border: `2px solid ${theme.canvas.brand}`,
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
              color: theme.canvas.brand,
              fontSize: '0.9rem',
              background: theme.canvas.inactive,
              borderRadius: 8,
              border: `1px dashed ${theme.canvas.border}`,
              fontStyle: 'italic'
            }}>
              No universes found. Create one to get started.
            </div>
          ) : (
            universes.map((universe) => {
              const isActive = universe.slug === activeUniverseSlug;
              const resolvedSource = universe.sourceOfTruth || universe.raw?.sourceOfTruth || universe.storage?.primary?.type || null;
              const storedNodeCount = universe.nodeCount || universe.raw?.nodeCount || universe.metadata?.nodeCount || universe.raw?.metadata?.nodeCount || 0;
              const storedConnectionCount = universe.connectionCount || universe.raw?.connectionCount || universe.metadata?.connectionCount || universe.raw?.metadata?.connectionCount || 0;
              const storedGraphCount = universe.graphCount || universe.raw?.graphCount || universe.metadata?.graphCount || universe.raw?.metadata?.graphCount || 0;

              // For the active universe, use live Zustand-derived metrics
              const nodeCount = (isActive && liveMetrics) ? liveMetrics.nodeCount : storedNodeCount;
              const connectionCount = (isActive && liveMetrics) ? liveMetrics.connectionCount : storedConnectionCount;
              const graphCount = (isActive && liveMetrics) ? liveMetrics.graphCount : storedGraphCount;

              return (
                <div
                  key={universe.slug}
                  style={{
                    border: isActive ? `2px solid ${theme.canvas.brand}` : `1px solid ${theme.canvas.border}`,
                    borderRadius: 8,
                    backgroundColor: theme.canvas.bg,
                    padding: 12,

                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10
                  }}
                >
                  {/* Header */}
                  <div style={{
                    display: 'flex',
                    flexDirection: isVerySlim ? 'column' : 'row',
                    justifyContent: isVerySlim ? 'flex-start' : 'space-between',
                    alignItems: isVerySlim ? 'flex-start' : 'center',
                    gap: isVerySlim ? 8 : 0
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 600, color: theme.canvas.textPrimary }}>{universe.name}</span>
                        {isActive && (
                          <span style={{
                            fontSize: '0.6rem',
                            padding: '2px 6px',
                            borderRadius: 10,
                            backgroundColor: theme.canvas.brand,
                            color: '#DEDADA',
                            fontWeight: 700
                          }}>
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <div style={{
                        fontSize: isSlim ? '0.65rem' : '0.7rem',
                        color: theme.canvas.textSecondary,
                        display: 'flex',
                        gap: isSlim ? 6 : 8,
                        flexWrap: 'wrap'
                      }}>
                        <span>{graphCount} webs</span>
                        <span>·</span>
                        <span>{nodeCount} things</span>
                        {!isSlim && (
                          <>
                            <span>·</span>
                            <span>{connectionCount} connections</span>
                          </>
                        )}
                      </div>
                    </div>
                    {/* Action buttons - on right in normal mode, below in very-slim mode */}
                    {(!isActive || universes.length > 1) && (
                      <div style={{
                        display: 'flex',
                        gap: isVerySlim ? 2 : (isSlim ? 4 : 6),
                        alignItems: 'center',
                        flexShrink: 0
                      }}>
                        {!isActive && (
                          <PanelIconButton
                            icon={ArrowRightLeft}
                            size={isVerySlim ? 14 : (isSlim ? 18 : 20)}
                            style={isVerySlim ? { padding: '5px' } : {}}
                            onClick={() => onSwitchUniverse(universe.slug)}
                            title="Switch to this universe"
                          />
                        )}
                        {universes.length > 1 && (
                          <PanelIconButton
                            icon={X}
                            size={isVerySlim ? 14 : (isSlim ? 18 : 20)}
                            style={isVerySlim ? { padding: '5px' } : {}}
                            onClick={() => onDeleteUniverse(universe.slug, universe.name)}
                            title="Delete universe"
                          />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Expanded Content - Only for Active Universe */}
                  {isActive && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingLeft: 24 }}>
                      {/* Storage Slots */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: theme.canvas.textPrimary }}>
                          Storage
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {/* Repository Slot */}
                          {universe.raw?.gitRepo?.linkedRepo ? (
                            <div
                              style={{
                                padding: 8,
                                backgroundColor: theme.canvas.bg,
                                borderRadius: 6,
                                border: `2px solid ${resolvedSource === 'git' ? theme.canvas.brand : theme.canvas.border}`,

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
                                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: theme.canvas.textPrimary }}>
                                    @{universe.raw.gitRepo.linkedRepo.user}/{universe.raw.gitRepo.linkedRepo.repo}
                                  </span>
                                  {/* Source-of-truth badge removed; button below handles status */}
                                </div>
                                <div style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: isVerySlim ? 1 : (isSlim ? 2 : 4),
                                  flexShrink: 0
                                }}>
                                  {onDownloadRepoFile && (
                                    <PanelIconButton
                                      icon={Download}
                                      size={isVerySlim ? 14 : (isSlim ? 16 : 18)}
                                      style={isVerySlim ? { padding: '5px' } : {}}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onDownloadRepoFile(universe.slug);
                                      }}
                                      title="Download latest from Git repository"
                                    />
                                  )}
                                  <PanelIconButton
                                    icon={X}
                                    size={isVerySlim ? 14 : (isSlim ? 16 : 18)}
                                    style={isVerySlim ? { padding: '5px' } : {}}
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
                                const gitFolder = universe.raw?.gitRepo?.universeFolder || universe.slug;
                                const gitFile = universe.raw?.gitRepo?.universeFile || `${universe.slug}.redstring`;
                                const fileName = `${gitFolder}/${gitFile}`;
                                const statusText = syncStatus?.status || 'unknown';
                                const lastSync = syncStatus?.lastSync ? formatWhen(syncStatus.lastSync) : 'Never';
                                const hasError = syncStatus?.error;
                                const isLoading = syncStatus?.isLoading || syncStatus?.isSyncing;

                                return (
                                  <div style={{
                                    fontSize: '0.65rem',
                                    color: theme.canvas.textSecondary,
                                    marginTop: '4px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 2
                                  }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <span style={{ fontWeight: 600, color: theme.canvas.textPrimary }}>File:</span>
                                      <span style={{ wordBreak: 'break-word' }}>
                                        {fileName}
                                      </span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <span style={{ fontWeight: 600, color: theme.canvas.textPrimary }}>Status:</span>
                                      <span style={{
                                        color: hasError ? theme.alert.error.text : isLoading ? theme.alert.warning.text : statusText === 'synced' ? theme.canvas.brand : theme.canvas.textSecondary,
                                        fontWeight: 500
                                      }}>
                                        {isLoading ? '⟳ Loading...' : hasError ? '⚠ Error' : statusText}
                                      </span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <span style={{ fontWeight: 600, color: theme.canvas.textPrimary }}>Last saved:</span>
                                      <span style={{ color: theme.canvas.textSecondary }}>{lastSync}</span>
                                    </div>
                                    {hasError && (
                                      <div style={{
                                        marginTop: 4,
                                        padding: '3px 6px',
                                        backgroundColor: theme.alert.error.bg,
                                        borderRadius: 3,
                                        border: `1px solid ${theme.alert.error.border}`
                                      }}>
                                        <span style={{ color: theme.alert.error.text, fontSize: '0.6rem' }}>
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
                                      onMouseEnter={(e) => { if (canToggle) e.currentTarget.style.transform = 'scale(1.04)'; }}
                                      onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                                      style={{
                                        fontSize: '0.65rem',
                                        padding: '2px 6px',
                                        borderRadius: 6,
                                        cursor: canToggle ? 'pointer' : 'default',
                                        fontWeight: 600,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        border: `1px solid ${theme.darkMode ? '#CCAAA8' : theme.canvas.brand}`,
                                        backgroundColor: isSourceOfTruth
                                          ? (theme.darkMode ? '#CCAAA8' : theme.canvas.brand)
                                          : 'transparent',
                                        color: isSourceOfTruth
                                          ? (theme.darkMode ? '#260000' : '#DEDADA')
                                          : (theme.darkMode ? '#CCAAA8' : theme.canvas.brand),

                                        opacity: canToggle ? 1 : 0.85
                                      }}
                                      title={!canToggle ? 'Only storage option (must remain source of truth)' : isSourceOfTruth ? 'Currently source of truth' : 'Click to make source of truth'}
                                    >
                                      <Star size={10} fill={isSourceOfTruth ? (theme.darkMode ? '#260000' : '#DEDADA') : 'none'} />

                                      {isSourceOfTruth ? 'Source of Truth' : 'Not Source of Truth'}
                                    </button>
                                  );
                                })()}
                                {onSaveRepoSource && (
                                  <PanelIconButton
                                    icon={Save}
                                    size={isVerySlim ? 14 : (isSlim ? 16 : 18)}
                                    style={isVerySlim ? { padding: '5px' } : {}}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onSaveRepoSource(universe.slug);
                                    }}
                                    title="Save to repository"
                                  />
                                )}
                              </div>
                            </div>
                          ) : (
                            <div style={{
                              padding: 12,
                              backgroundColor: 'transparent',
                              borderRadius: 6,
                              border: `2px dashed ${theme.canvas.border}`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}>
                                <PanelIconButton
                                  icon={Plus}
                                  label={isVerySlim ? null : "Add Repository"}
                                  variant="outline"
                                  size={isVerySlim ? 14 : 12}
                                  strokeWidth={2}
                                  hoverStrokeWidth={4}
                                  hoverTextColor={theme.accent.primary}
                                  style={{
                                    fontSize: '0.7rem',
                                    color: theme.canvas.textSecondary,
                                    borderColor: theme.canvas.border,
                                    ...(isVerySlim && { padding: '5px' })
                                  }}
                                  onClick={() => onLinkRepo && onLinkRepo(universe.slug)}
                                  title={isVerySlim ? "Add Repository" : undefined}
                                />
                            </div>
                          )}

                          {/* Local File Slot */}
                          {universe.raw?.localFile?.enabled || universe.raw?.localFile?.pendingConnect ? (
                            <div
                              style={{
                                padding: 8,
                                backgroundColor: theme.canvas.bg,
                                borderRadius: 6,
                                border: `2px solid ${resolvedSource === 'local' ? theme.canvas.brand : theme.canvas.border}`,
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
                                const lastSavedColor = localFile.lastSaved ? theme.canvas.textPrimary : theme.canvas.textSecondary;

                                return (
                                  <>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <Save size={14} />
                                        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: theme.canvas.textPrimary }}>
                                          Local File
                                        </span>
                                        {/* Source-of-truth badge removed; button below handles status */}
                                      </div>
                                      <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: isVerySlim ? 1 : (isSlim ? 2 : 4),
                                        flexShrink: 0
                                      }}>
                                        {onSwapLocalFile && (
                                          <PanelIconButton
                                            icon={ArrowRightLeft}
                                            size={isVerySlim ? 14 : (isSlim ? 16 : 18)}
                                            style={isVerySlim ? { padding: '5px' } : {}}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onSwapLocalFile(universe.slug);
                                            }}
                                            title="Swap file"
                                          />
                                        )}
                                        {onDownloadLocalFile && (
                                          <PanelIconButton
                                            icon={Download}
                                            size={isVerySlim ? 14 : (isSlim ? 16 : 18)}
                                            style={isVerySlim ? { padding: '5px' } : {}}
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
                                            size={isVerySlim ? 14 : (isSlim ? 16 : 18)}
                                            style={isVerySlim ? { padding: '5px' } : {}}
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
                                      color: theme.canvas.textSecondary,
                                      marginTop: '4px',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: 2
                                    }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <span style={{ fontWeight: 600, color: theme.canvas.textPrimary }}>File:</span>
                                        <span style={{ wordBreak: 'break-word' }}>
                                          {localFile.displayPath || localFile.path || localFile.lastFilePath || localFile.suggestedPath || `${universe.slug}.redstring`}
                                        </span>
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <span style={{ fontWeight: 600, color: theme.canvas.textPrimary }}>Last saved:</span>
                                        <span style={{ color: lastSavedColor }}>
                                          {lastSavedLabel}
                                        </span>
                                      </div>
                                    </div>

                                    {localFile.pendingConnect && (
                                      <div
                                        style={{
                                          marginTop: 6,
                                          padding: '6px 8px',
                                          borderRadius: 6,
                                          backgroundColor: theme.alert.warning.bg,
                                          border: `1px solid ${theme.alert.warning.border}`,
                                          display: 'flex',
                                          flexDirection: 'column',
                                          gap: 6
                                        }}
                                      >
                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                                          <Info size={14} color={theme.alert.warning.text} style={{ marginTop: 2, flexShrink: 0 }} />
                                          <span style={{ fontSize: '0.65rem', color: theme.alert.warning.text, lineHeight: 1.3 }}>
                                            File imported but not linked. Connect to enable auto-save.
                                          </span>
                                        </div>
                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                          <PanelIconButton
                                            icon={FileText}
                                            label="Pick File / Save As"
                                            variant="solid"
                                            size={12}
                                            style={{ 
                                              fontSize: '0.65rem',
                                              padding: '4px 10px',
                                              backgroundColor: theme.alert.warning.text,
                                              border: 'none',
                                              width: 'auto'
                                            }}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (onGrantLocalPermission) {
                                                onGrantLocalPermission(universe.slug, { mode: 'saveAs', suggestedName: localFile.lastImportedFile || localFile.displayPath });
                                              }
                                            }}
                                          />
                                        </div>
                                      </div>
                                    )}

                                    {localFile.fileHandleStatus === 'needs_reconnect' && (
                                      <div
                                        style={{
                                          marginTop: 6,
                                          padding: '6px 8px',
                                          borderRadius: 6,
                                          backgroundColor: theme.alert.error.bg,
                                          border: `1px solid ${theme.alert.error.border}`,
                                          color: theme.alert.error.text,
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
                                            <PanelIconButton
                                              icon={RotateCcw}
                                              label="Reconnect"
                                              variant="outline"
                                              size={12}
                                              style={{
                                                fontSize: '0.62rem',
                                                padding: '2px 8px',
                                                borderColor: theme.canvas.brand,
                                                color: theme.canvas.brand
                                              }}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                onLinkLocalFile(universe.slug);
                                              }}
                                            />
                                        )}
                                      </div>
                                    )}
                                    {localFile.fileHandleStatus === 'permission_needed' && (
                                      <div
                                        style={{
                                          marginTop: 6,
                                          padding: '6px 8px',
                                          borderRadius: 6,
                                          backgroundColor: theme.alert.warning.bg,
                                          border: `1px solid ${theme.alert.warning.border}`,
                                          color: theme.alert.warning.text,
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
                                            <PanelIconButton
                                              icon={Key}
                                              label="Grant Access"
                                              variant="outline"
                                              size={12}
                                              style={{
                                                fontSize: '0.62rem',
                                                padding: '2px 8px',
                                                borderColor: theme.alert.warning.text,
                                                color: theme.alert.warning.text
                                              }}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                onGrantLocalPermission(universe.slug);
                                              }}
                                            />
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
                                            onMouseEnter={(e) => { if (canToggle) e.currentTarget.style.transform = 'scale(1.04)'; }}
                                            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                                            style={{
                                              fontSize: '0.65rem',
                                              padding: '2px 6px',
                                              borderRadius: 6,
                                              cursor: canToggle ? 'pointer' : 'default',
                                              fontWeight: 600,
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: 4,
                                              border: `1px solid ${theme.canvas.brand}`,
                                              backgroundColor: isSourceOfTruth ? theme.canvas.brand : 'transparent',
                                              color: isSourceOfTruth ? '#DEDADA' : theme.canvas.brand,

                                              opacity: canToggle ? 1 : 0.85
                                            }}
                                            title={!canToggle ? 'Only storage option (must remain source of truth)' : isSourceOfTruth ? 'Currently source of truth' : 'Click to make source of truth'}
                                          >
                                            <Star size={10} fill={isSourceOfTruth ? (theme.darkMode ? '#260000' : '#DEDADA') : 'none'} />

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
                                border: `2px dashed ${theme.canvas.border}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                position: 'relative'
                              }}
                            >
                                <PanelIconButton
                                  icon={Plus}
                                  label={isVerySlim ? null : (
                                    <React.Fragment>
                                      Add Local File <ChevronDown size={10} style={{ verticalAlign: 'middle', marginBottom: '1px' }} />
                                    </React.Fragment>
                                  )}
                                  variant="outline"
                                  size={isVerySlim ? 14 : 12}
                                  strokeWidth={2}
                                  hoverStrokeWidth={4}
                                  hoverTextColor={theme.accent.primary}
                                  style={{
                                    fontSize: '0.7rem',
                                    color: theme.canvas.textSecondary,
                                    borderColor: theme.canvas.border,
                                    ...(isVerySlim && { padding: '5px' })
                                  }}
                                  onClick={() => setShowLocalFileMenu(showLocalFileMenu === universe.slug ? null : universe.slug)}
                                  title={isVerySlim ? "Add Local File" : undefined}
                                />

                              {showLocalFileMenu === universe.slug && (
                                <div style={{
                                  position: 'absolute',
                                  top: '100%',
                                  left: '50%',
                                  transform: 'translateX(-50%)',
                                  marginTop: 4,
                                  backgroundColor: theme.canvas.bg,
                                  border: `1px solid ${theme.canvas.border}`,
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
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.backgroundColor = theme.canvas.hover;
                                      e.currentTarget.style.transform = 'scale(1.04)';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.backgroundColor = 'transparent';
                                      e.currentTarget.style.transform = 'scale(1)';
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
                                      color: theme.canvas.textPrimary,
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6
                                    }}
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
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.backgroundColor = theme.canvas.hover;
                                      e.currentTarget.style.transform = 'scale(1.04)';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.backgroundColor = 'transparent';
                                      e.currentTarget.style.transform = 'scale(1)';
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
                                      color: theme.canvas.textPrimary,
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6
                                    }}
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
                              border: `1px solid ${theme.canvas.brand}`,
                              fontSize: '0.7rem',
                              color: theme.canvas.brand,
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
