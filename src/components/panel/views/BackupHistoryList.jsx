import React, { useCallback, useEffect, useState } from 'react';
import { Archive, FolderOpen, RefreshCw } from 'lucide-react';
import universeBackend from '../../../services/universeBackend.js';
import {
  listBackups,
  getBackupMode,
  subscribeBackupMode,
  canRevealBackups,
  revealBackups
} from '../../../services/universeBackups.js';
import { formatBytes } from '../../../utils/formatBytes.js';
import RestoreVersionDialog from '../../shared/RestoreVersionDialog.jsx';
import { formatRevisionTime } from './GitHistoryList.jsx';

/**
 * Earlier copies of the open universe kept on this device, newest first
 * (src/services/universeBackups.js). The local twin of GitHistoryList: the
 * same rows, the same confirm, and size again as the column that tells a
 * good copy from a bad one at a glance.
 */

const formatBackupTime = (ms) => {
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  } catch {
    return '';
  }
};

const BackupHistoryList = ({ isSlim = false }) => {
  const [backups, setBackups] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [mode, setMode] = useState(getBackupMode);

  useEffect(() => subscribeBackupMode(setMode), []);

  const universe = universeBackend.getActiveUniverse();
  const slug = universe?.slug || null;

  const load = useCallback(async () => {
    if (!slug) {
      setBackups([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      setBackups(await listBackups(slug));
    } catch (e) {
      setError(e?.message || 'Could not read the backups.');
    } finally {
      setIsLoading(false);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  const restore = async () => {
    if (!pending?.id) return;
    setIsRestoring(true);
    try {
      await universeBackend.restoreUniverseBackup(slug, pending.id);
      setPending(null);
      await load(); // What was open before is now a backup too.
    } catch (e) {
      setError(e?.message || 'Could not restore that backup.');
      setPending(null);
    } finally {
      setIsRestoring(false);
    }
  };

  if (!universe) {
    return <div className="git-history-empty"><p>No universe is open.</p></div>;
  }

  const name = universe.name || slug;

  return (
    <>
      <div className="git-history-bar">
        <span className="git-history-repo" title="Kept on this device">
          <Archive size={12} />
          <span className="git-history-repo-name">On this device</span>
        </span>
        {canRevealBackups() && (
          <button
            className="git-history-refresh"
            onClick={() => revealBackups(slug)}
            data-nav="item"
            title="Show the backup files"
          >
            <FolderOpen size={12} />
          </button>
        )}
        <button
          className="git-history-refresh"
          onClick={load}
          disabled={isLoading}
          data-nav="item"
          title="Check for new backups"
        >
          <RefreshCw size={12} className={isLoading ? 'git-history-spin' : undefined} />
        </button>
      </div>

      {error && backups.length > 0 && (
        <div className="git-history-empty"><small>{error}</small></div>
      )}

      <div className="history-list">
        {backups.length === 0 ? (
          <div className="git-history-empty">
            <Archive size={40} opacity={0.2} />
            <p>{error || 'No backups yet'}</p>
            <small>
              {mode === 'off'
                ? 'Backups are off. Turn them on in Settings, under Data.'
                : 'A copy is kept every ten minutes while this universe saves to a file.'}
            </small>
          </div>
        ) : (
          backups.map((backup) => (
            <div
              key={backup.id}
              className="history-item git-revision"
              data-nav="item"
              onClick={() => setPending(backup)}
              title="Restore this backup"
            >
              <div className="history-item-icon">
                <Archive size={14} />
              </div>
              <div className="history-item-content">
                <div className="history-item-description">{formatBackupTime(backup.at)}</div>
                <div className="history-item-meta">
                  {!isSlim && <span className="history-time">{formatRevisionTime(new Date(backup.at).toISOString())}</span>}
                  {formatBytes(backup.size) && <span className="git-revision-size">{formatBytes(backup.size)}</span>}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <RestoreVersionDialog
        isOpen={!!pending}
        universeName={name}
        version={pending ? { ...pending, date: new Date(pending.at).toISOString() } : null}
        isRestoring={isRestoring}
        title="Restore this backup"
        subtitle={`Puts "${name}" back the way it was. What is open now is kept as a backup first.`}
        role="On this device"
        dismissLabel="Cancel"
        onRestore={restore}
        onDismiss={isRestoring ? undefined : () => setPending(null)}
      />
    </>
  );
};

export default BackupHistoryList;
