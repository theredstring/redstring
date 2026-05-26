import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Link as LinkIcon,
  RefreshCw,
  AlertCircle,
  FileText,
  HardDrive,
  GitBranch,
  EyeOff,
  ArrowLeft
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
  onSaveAsLocalFile,
  onAttachToRepo,
  onKeepInMemory
}) => {
  const theme = useTheme();
  const [url, setUrl] = useState('');
  const [classification, setClassification] = useState({ kind: 'invalid' });
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false); // fetching/previewing/committing
  const [error, setError] = useState(null);
  const [files, setFiles] = useState([]);
  const [preview, setPreview] = useState(null); // when set, modal shows preview view
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
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (preview) return; // in preview phase, don't re-classify
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
  }, [url, preview]);

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

  const runDestination = useCallback(async (action) => {
    if (!preview || !action) return;
    setBusy(true);
    setError(null);
    try {
      await action(preview.storeState, preview.suggestedName, preview.sourceUrl);
      // The handler is responsible for closing the modal on success.
    } catch (err) {
      setError(err.message || 'Action failed');
      setBusy(false);
    }
  }, [preview]);

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

  // ------- PREVIEW VIEW -------
  if (preview) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Choose Destination" size="medium">
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
          {/* Preview summary */}
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

          {/* Destination buttons */}
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
              onClick={() => runDestination(onSaveAsLocalFile)}
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

            <button
              onClick={() => runDestination(onAttachToRepo)}
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
                <div>Attach to GitHub repo...</div>
                <div style={{ fontSize: '0.7rem', fontWeight: 400, opacity: 0.9, marginTop: '2px' }}>
                  Push as a new universe to one of your repos.
                </div>
              </div>
            </button>

            <div style={{
              marginTop: '6px',
              paddingTop: '10px',
              borderTop: `1px dashed ${theme.canvas.border}`
            }}>
              <button
                onClick={() => runDestination(onKeepInMemory)}
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

  // ------- URL INPUT / PICKER VIEW -------
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

            {files.map((file) => (
              <div
                key={file.path}
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
                      {file.name}
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      color: theme.canvas.textSecondary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {file.path}{file.size ? ` · ${formatBytes(file.size)}` : ''}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => fetchAndPreview(file.downloadUrl, suggestUniverseNameFromUrl(file.name))}
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
