import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Link as LinkIcon,
  RefreshCw,
  AlertCircle,
  FileText,
  HardDrive,
  GitBranch,
  EyeOff,
  ArrowLeft,
  Search,
  Lock,
  Unlock
} from 'lucide-react';
import Modal from '../shared/Modal.jsx';
import { useTheme } from '../../hooks/useTheme.js';
import {
  classifyUrl,
  fetchRedstringJson,
  listRedstringFilesInGithub,
  suggestUniverseNameFromUrl
} from '../../services/externalUniverseLoader.js';
import { importFromRedstring } from '../../formats/redstringFormat.js';
import { hasCapability } from '../../utils/deviceDetection.js';
import { persistentAuth } from '../../services/persistentAuth.js';

const formatBytes = (n) => {
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const kindLabel = (kind) => {
  switch (kind) {
    case 'github-file': return 'GitHub file detected';
    case 'github-folder': return 'GitHub folder detected';
    case 'github-repo': return 'GitHub repo detected';
    case 'raw-file': return 'Direct file URL detected';
    default: return '';
  }
};

const slugify = (s) => (s || '')
  .toLowerCase()
  .replace(/[^a-z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 64) || 'universe';

const buildPreviewFromJson = (jsonData, suggestedName, sourceUrl) => {
  const importResult = importFromRedstring(jsonData);
  const storeState = importResult?.storeState;
  if (!storeState) {
    throw new Error('Invalid .redstring file: import returned no store state');
  }
  return {
    storeState,
    suggestedName,
    sourceUrl,
    graphCount: storeState.graphs?.size ?? 0,
    protoCount: storeState.nodePrototypes?.size ?? 0,
    edgeCount: storeState.edges?.size ?? 0,
    errors: importResult.errors || []
  };
};

const ExternalLinkLoadModal = ({
  isOpen,
  onClose,
  onPublishToRepo,
  onSaveAsLocalFile,
  onKeepInMemory
}) => {
  const theme = useTheme();
  const canAccessLocalFiles = hasCapability('local-files');

  // URL input + scan state
  const [url, setUrl] = useState('');
  const [classification, setClassification] = useState({ kind: 'invalid' });
  const [scanning, setScanning] = useState(false);
  const [files, setFiles] = useState([]);

  // Shared state
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Preview state
  const [preview, setPreview] = useState(null);

  // Publish-phase state
  const [publishPhase, setPublishPhase] = useState(false);
  const [repos, setRepos] = useState([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [repoSearch, setRepoSearch] = useState('');
  const [selectedRepo, setSelectedRepo] = useState(null); // { user, repo, full_name, private }
  const [folder, setFolder] = useState('');
  const [file, setFile] = useState('');

  const inputRef = useRef(null);
  const scanIdRef = useRef(0);

  useEffect(() => {
    if (isOpen) {
      setUrl('');
      setClassification({ kind: 'invalid' });
      setScanning(false);
      setBusy(false);
      setError(null);
      setFiles([]);
      setPreview(null);
      setPublishPhase(false);
      setRepos([]);
      setReposLoading(false);
      setRepoSearch('');
      setSelectedRepo(null);
      setFolder('');
      setFile('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (preview || publishPhase) return;
    const c = classifyUrl(url);
    setClassification(c);
    setError(null);
    setFiles([]);

    if (c.kind === 'github-folder' || c.kind === 'github-repo') {
      const myId = ++scanIdRef.current;
      setScanning(true);
      const args = c.kind === 'github-folder'
        ? { owner: c.owner, repo: c.repo, branch: c.branch, path: c.path, scope: 'folder' }
        : { owner: c.owner, repo: c.repo, scope: 'repo' };

      listRedstringFilesInGithub(args)
        .then((found) => {
          if (myId !== scanIdRef.current) return;
          setFiles(found);
          if (found.length === 0) {
            setError('No .redstring files found in that location.');
          }
        })
        .catch((err) => {
          if (myId !== scanIdRef.current) return;
          setError(err.message || 'Failed to list files');
        })
        .finally(() => {
          if (myId === scanIdRef.current) setScanning(false);
        });
    }
  }, [url, preview, publishPhase]);

  const fetchAndPreview = useCallback(async (rawUrl, suggestedName) => {
    setBusy(true);
    setError(null);
    try {
      const jsonData = await fetchRedstringJson(rawUrl);
      const name = suggestedName || suggestUniverseNameFromUrl(rawUrl);
      const p = buildPreviewFromJson(jsonData, name, rawUrl);
      setPreview(p);
    } catch (err) {
      setError(err.message || 'Failed to load file');
    } finally {
      setBusy(false);
    }
  }, []);

  const startPublishPhase = useCallback(async () => {
    if (!preview) return;
    setError(null);
    setPublishPhase(true);
    // Initialize default folder/file from preview name
    const slug = slugify(preview.suggestedName);
    setFolder(slug);
    setFile(`${slug}.redstring`);

    // Load user's repos
    setReposLoading(true);
    try {
      const token = await persistentAuth.getAccessToken();
      if (!token) {
        throw new Error('Not connected to GitHub. Use Universe Manager to connect first.');
      }
      const res = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100', {
        headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' }
      });
      if (!res.ok) {
        throw new Error(`Failed to list your repos: HTTP ${res.status}`);
      }
      const list = await res.json();
      if (!Array.isArray(list)) throw new Error('Unexpected response listing repos');
      setRepos(list);
    } catch (err) {
      setError(err.message || 'Failed to load your repositories');
    } finally {
      setReposLoading(false);
    }
  }, [preview]);

  const runSimpleDestination = useCallback(async (action) => {
    if (!preview || !action) return;
    setBusy(true);
    setError(null);
    try {
      await action(preview.storeState, preview.suggestedName, preview.sourceUrl);
    } catch (err) {
      setError(err.message || 'Action failed');
      setBusy(false);
    }
  }, [preview]);

  const runPublish = useCallback(async () => {
    if (!preview || !selectedRepo || !onPublishToRepo) return;
    const cleanFolder = (folder || '').trim().replace(/^\/+|\/+$/g, '');
    const cleanFile = (file || '').trim();
    if (!cleanFolder || !cleanFile) {
      setError('Folder and file name are required.');
      return;
    }
    if (!/\.redstring$/i.test(cleanFile)) {
      setError('File name must end in .redstring');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onPublishToRepo({
        storeState: preview.storeState,
        suggestedName: preview.suggestedName,
        sourceUrl: preview.sourceUrl,
        repoOwner: selectedRepo.owner?.login || selectedRepo.user,
        repoName: selectedRepo.name || selectedRepo.repo,
        folder: cleanFolder,
        file: cleanFile
      });
    } catch (err) {
      setError(err.message || 'Publish failed');
      setBusy(false);
    }
  }, [preview, selectedRepo, folder, file, onPublishToRepo]);

  const filteredRepos = useMemo(() => {
    const q = repoSearch.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(r =>
      (r.name || '').toLowerCase().includes(q) ||
      (r.full_name || '').toLowerCase().includes(q) ||
      (r.description || '').toLowerCase().includes(q)
    );
  }, [repos, repoSearch]);

  const statusColor = useMemo(() => {
    if (error) return theme.alert?.error?.text || '#c93030';
    if (classification.kind === 'invalid') return theme.canvas.textSecondary;
    return theme.canvas.brand || theme.canvas.textPrimary;
  }, [error, classification, theme]);

  const statusText = useMemo(() => {
    if (error) return error;
    if (!url.trim()) return 'Paste a link to a .redstring file, GitHub file, folder, or repo.';
    if (classification.kind === 'invalid') return classification.reason || 'Unrecognized URL';
    if (scanning) return `${kindLabel(classification.kind)} — scanning…`;
    return kindLabel(classification.kind);
  }, [error, url, classification, scanning]);

  // ------- PUBLISH PHASE -------
  if (publishPhase && preview) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Copy to a New Repo" size="medium">
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
          <div style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${theme.canvas.border}`,
            backgroundColor: theme.canvas.bg,
            flexShrink: 0
          }}>
            <button
              onClick={() => { setPublishPhase(false); setSelectedRepo(null); setError(null); }}
              disabled={busy}
              style={{
                background: 'none',
                border: 'none',
                color: theme.canvas.textSecondary,
                padding: 0,
                fontSize: '0.7rem',
                cursor: busy ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                marginBottom: '8px',
                opacity: busy ? 0.5 : 1
              }}
            >
              <ArrowLeft size={12} />
              Back to preview
            </button>
            <div style={{ fontSize: '0.8rem', color: theme.canvas.textSecondary }}>
              Copy <strong style={{ color: theme.canvas.textPrimary }}>{preview.suggestedName}</strong> into one of your repositories.
            </div>
          </div>

          {/* Repo search + list */}
          <div style={{
            padding: '10px 12px',
            borderBottom: `1px solid ${theme.canvas.border}`,
            flexShrink: 0
          }}>
            <div style={{ position: 'relative', marginBottom: '8px' }}>
              <Search
                size={12}
                style={{
                  position: 'absolute',
                  left: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  opacity: 0.6,
                  color: theme.canvas.textPrimary
                }}
              />
              <input
                type="text"
                placeholder={reposLoading ? 'Loading repositories…' : 'Search your repositories'}
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
                disabled={reposLoading}
                style={{
                  width: '100%',
                  padding: '6px 8px 6px 24px',
                  border: `1px solid ${theme.canvas.border}`,
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  backgroundColor: theme.canvas.border,
                  color: theme.canvas.textPrimary,
                  boxSizing: 'border-box',
                  fontFamily: "'EmOne', sans-serif"
                }}
              />
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
            {reposLoading && (
              <div style={{ textAlign: 'center', padding: '20px', color: theme.canvas.textSecondary, fontSize: '0.8rem' }}>
                <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading…
              </div>
            )}
            {!reposLoading && filteredRepos.length === 0 && (
              <div style={{ textAlign: 'center', padding: '20px', color: theme.canvas.textSecondary, fontSize: '0.8rem' }}>
                {repos.length === 0 ? 'No repositories found.' : 'No matches.'}
              </div>
            )}
            {filteredRepos.map((r) => {
              const isSelected = selectedRepo?.id === r.id;
              return (
                <div
                  key={r.id || r.full_name}
                  onClick={() => setSelectedRepo(r)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 10px',
                    marginBottom: '4px',
                    border: `1px solid ${isSelected ? theme.canvas.brand : theme.canvas.border}`,
                    borderRadius: '6px',
                    backgroundColor: isSelected ? theme.canvas.hover : theme.canvas.bg,
                    cursor: 'pointer'
                  }}
                >
                  {r.private ? <Lock size={12} /> : <Unlock size={12} style={{ opacity: 0.6 }} />}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: theme.canvas.textPrimary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {r.full_name || `${r.owner?.login}/${r.name}`}
                    </div>
                    {r.description && (
                      <div style={{
                        fontSize: '0.7rem',
                        color: theme.canvas.textSecondary,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {r.description}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Path inputs + publish */}
          <div style={{
            padding: '12px 16px',
            borderTop: `1px solid ${theme.canvas.border}`,
            backgroundColor: theme.canvas.bg,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            {error && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: theme.alert?.error?.text || '#c93030',
                backgroundColor: theme.alert?.error?.bg || 'rgba(201,48,48,0.1)',
                padding: '6px 8px',
                borderRadius: '4px',
                fontSize: '0.7rem'
              }}>
                <AlertCircle size={12} />
                <span>{error}</span>
              </div>
            )}
            <div style={{ fontSize: '0.7rem', color: theme.canvas.textSecondary }}>
              Path: universes/<strong style={{ color: theme.canvas.textPrimary }}>{folder || '—'}</strong>/<strong style={{ color: theme.canvas.textPrimary }}>{file || '—'}</strong>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="folder"
                disabled={busy || !selectedRepo}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  border: `1px solid ${theme.canvas.border}`,
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  backgroundColor: theme.canvas.border,
                  color: theme.canvas.textPrimary,
                  fontFamily: "'EmOne', sans-serif"
                }}
              />
              <input
                type="text"
                value={file}
                onChange={(e) => setFile(e.target.value)}
                placeholder="file.redstring"
                disabled={busy || !selectedRepo}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  border: `1px solid ${theme.canvas.border}`,
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  backgroundColor: theme.canvas.border,
                  color: theme.canvas.textPrimary,
                  fontFamily: "'EmOne', sans-serif"
                }}
              />
            </div>
            <button
              onClick={runPublish}
              disabled={busy || !selectedRepo || !folder.trim() || !file.trim()}
              style={{
                background: theme.canvas.brand,
                border: `1px solid ${theme.canvas.brand}`,
                color: '#fff',
                padding: '8px 12px',
                borderRadius: '4px',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: (busy || !selectedRepo) ? 'not-allowed' : 'pointer',
                opacity: (busy || !selectedRepo) ? 0.6 : 1,
                fontFamily: "'EmOne', sans-serif",
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              <GitBranch size={14} />
              {busy ? 'Copying…' : selectedRepo ? `Copy to ${selectedRepo.full_name || `${selectedRepo.owner?.login}/${selectedRepo.name}`}` : 'Pick a repository first'}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // ------- PREVIEW PHASE -------
  if (preview) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Choose Destination" size="medium">
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
          <div style={{
            padding: '14px 16px',
            borderBottom: `1px solid ${theme.canvas.border}`,
            backgroundColor: theme.canvas.bg,
            flexShrink: 0
          }}>
            <button
              onClick={() => { setPreview(null); setError(null); }}
              disabled={busy}
              style={{
                background: 'none',
                border: 'none',
                color: theme.canvas.textSecondary,
                padding: 0,
                fontSize: '0.7rem',
                cursor: busy ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                marginBottom: '8px',
                opacity: busy ? 0.5 : 1
              }}
            >
              <ArrowLeft size={12} />
              Back
            </button>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '6px'
            }}>
              <FileText size={16} style={{ color: theme.canvas.textSecondary }} />
              <div style={{
                fontSize: '0.95rem',
                fontWeight: 700,
                color: theme.canvas.textPrimary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {preview.suggestedName}
              </div>
            </div>
            <div style={{
              fontSize: '0.75rem',
              color: theme.canvas.textSecondary,
              display: 'flex',
              gap: '14px',
              flexWrap: 'wrap'
            }}>
              <span>{preview.graphCount} graph{preview.graphCount === 1 ? '' : 's'}</span>
              <span>{preview.protoCount} prototype{preview.protoCount === 1 ? '' : 's'}</span>
              <span>{preview.edgeCount} edge{preview.edgeCount === 1 ? '' : 's'}</span>
            </div>
            <div style={{
              fontSize: '0.7rem',
              color: theme.canvas.textSecondary,
              marginTop: '6px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {preview.sourceUrl}
            </div>
          </div>

          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}>
            {error && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: theme.alert?.error?.text || '#c93030',
                backgroundColor: theme.alert?.error?.bg || 'rgba(201,48,48,0.1)',
                padding: '8px 10px',
                borderRadius: '4px',
                fontSize: '0.75rem'
              }}>
                <AlertCircle size={12} />
                <span>{error}</span>
              </div>
            )}

            <button
              onClick={startPublishPhase}
              disabled={busy}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '12px 14px',
                border: `1px solid ${theme.canvas.brand}`,
                borderRadius: '6px',
                background: theme.canvas.brand,
                color: '#fff',
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.6 : 1,
                fontFamily: "'EmOne', sans-serif",
                fontSize: '0.85rem',
                fontWeight: 600,
                textAlign: 'left'
              }}
            >
              <GitBranch size={16} />
              <div style={{ flex: 1 }}>
                <div>Copy to a new repo...</div>
                <div style={{ fontSize: '0.7rem', fontWeight: 400, opacity: 0.9, marginTop: '2px' }}>
                  Copy into one of your repositories as a new universe.
                </div>
              </div>
            </button>

            {canAccessLocalFiles && (
              <button
                onClick={() => runSimpleDestination(onSaveAsLocalFile)}
                disabled={busy}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '12px 14px',
                  border: `1px solid ${theme.canvas.brand}`,
                  borderRadius: '6px',
                  background: theme.canvas.brand,
                  color: '#fff',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                  fontFamily: "'EmOne', sans-serif",
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  textAlign: 'left'
                }}
              >
                <HardDrive size={16} />
                <div style={{ flex: 1 }}>
                  <div>Save as local file...</div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 400, opacity: 0.9, marginTop: '2px' }}>
                    Pick a save location. Persists across reload.
                  </div>
                </div>
              </button>
            )}

            <div style={{
              marginTop: '6px',
              paddingTop: '10px',
              borderTop: `1px dashed ${theme.canvas.border}`
            }}>
              <button
                onClick={() => runSimpleDestination(onKeepInMemory)}
                disabled={busy}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 10px',
                  border: `1px dashed ${theme.canvas.border}`,
                  borderRadius: '4px',
                  background: 'transparent',
                  color: theme.canvas.textSecondary,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy ? 0.5 : 0.85,
                  fontFamily: "'EmOne', sans-serif",
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  textAlign: 'left',
                  width: '100%'
                }}
              >
                <EyeOff size={12} />
                <div style={{ flex: 1 }}>
                  <div>Just view (won't persist)</div>
                  <div style={{ fontSize: '0.65rem', marginTop: '1px', opacity: 0.9 }}>
                    Data lives in memory only. Lost on reload.
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </Modal>
    );
  }

  // ------- URL INPUT PHASE -------
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Load from External Link" size="medium">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <div style={{
          padding: '12px',
          borderBottom: `1px solid ${theme.canvas.border}`,
          backgroundColor: theme.canvas.bg,
          flexShrink: 0
        }}>
          <div style={{ position: 'relative', marginBottom: '10px' }}>
            <LinkIcon
              size={14}
              style={{
                position: 'absolute',
                left: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                opacity: 0.6,
                color: theme.canvas.textPrimary
              }}
            />
            <input
              ref={inputRef}
              type="text"
              placeholder="https://github.com/owner/repo/blob/main/path.redstring"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 8px 8px 28px',
                border: `1px solid ${theme.canvas.border}`,
                borderRadius: '4px',
                fontSize: '0.8rem',
                backgroundColor: theme.canvas.border,
                color: theme.canvas.textPrimary,
                boxSizing: 'border-box',
                fontFamily: "'EmOne', sans-serif"
              }}
            />
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.75rem',
            color: statusColor,
            minHeight: '16px'
          }}>
            {error ? (
              <AlertCircle size={12} />
            ) : (scanning || busy) ? (
              <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
            ) : null}
            <span>{statusText}</span>
          </div>

          {(classification.kind === 'github-file' || classification.kind === 'raw-file') && (
            <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => fetchAndPreview(
                  classification.rawUrl,
                  suggestUniverseNameFromUrl(classification.path || classification.rawUrl)
                )}
                disabled={busy}
                style={{
                  background: theme.canvas.brand,
                  border: `1px solid ${theme.canvas.brand}`,
                  color: '#fff',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                  fontFamily: "'EmOne', sans-serif"
                }}
              >
                {busy ? 'Fetching…' : 'Fetch & preview'}
              </button>
            </div>
          )}
        </div>

        {(classification.kind === 'github-folder' || classification.kind === 'github-repo') && (
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '10px 12px'
          }}>
            {files.length === 0 && !scanning && !error && (
              <div style={{
                color: theme.canvas.textSecondary,
                fontSize: '0.8rem',
                textAlign: 'center',
                padding: '20px'
              }}>
                No .redstring files found.
              </div>
            )}

            {files.map((f) => (
              <div
                key={f.path}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  marginBottom: '6px',
                  border: `1px solid ${theme.canvas.border}`,
                  borderRadius: '6px',
                  backgroundColor: theme.canvas.bg
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <FileText size={14} style={{ flexShrink: 0, color: theme.canvas.textSecondary }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: theme.canvas.textPrimary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {f.name}
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      color: theme.canvas.textSecondary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {f.path}{f.size ? ` · ${formatBytes(f.size)}` : ''}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => fetchAndPreview(f.downloadUrl, suggestUniverseNameFromUrl(f.name))}
                  disabled={busy}
                  style={{
                    background: theme.canvas.brand,
                    border: `1px solid ${theme.canvas.brand}`,
                    color: '#fff',
                    padding: '4px 10px',
                    borderRadius: '4px',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    cursor: busy ? 'not-allowed' : 'pointer',
                    opacity: busy ? 0.6 : 1,
                    flexShrink: 0,
                    fontFamily: "'EmOne', sans-serif"
                  }}
                >
                  Preview
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ExternalLinkLoadModal;
