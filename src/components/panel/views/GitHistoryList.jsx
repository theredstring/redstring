import React, { useCallback, useEffect, useState } from 'react';
import { GitCommitVertical, Github, RefreshCw } from 'lucide-react';
import universeBackend from '../../../services/universeBackend.js';
import { formatBytes } from '../../../utils/formatBytes.js';
import RestoreVersionDialog from '../../shared/RestoreVersionDialog.jsx';

/**
 * Every version this universe has had in its repository, newest first.
 *
 * The repository keeps each one, so a write that empties a universe leaves the
 * previous content sitting in history untouched. That is the only reason the
 * 2026-09-12 wipe was recoverable, and until now nothing in the app could look
 * at it — which made a recoverable loss indistinguishable from a permanent one.
 *
 * Size is the column that does the work. A revision's byte count comes back
 * from the commit listing without downloading anything, so a universe that fell
 * from megabytes to kilobytes is legible by scanning, before a single revision
 * is opened:
 *
 *     3h ago    Update claude-s-chambers-2    16.1 KB
 *     4h ago    Update claude-s-chambers-2     6.6 MB   <- the one you want
 *
 * Counts cost a download, so they are fetched only for the revision the user
 * actually points at, and they arrive in the confirm dialog rather than here.
 */

export const formatRevisionTime = (date) => {
  const ms = date ? Date.parse(date) : NaN;
  if (Number.isNaN(ms)) return '';
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ms).toLocaleDateString();
};

/** The commit subject only — the body is never short enough for a panel row. */
const subjectOf = (message) => {
  const subject = String(message || '').split('\n')[0].trim();
  return subject || 'Update';
};

const GitHistoryList = ({ universeSlug = null, isSlim = false }) => {
  const [revisions, setRevisions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  // The revision awaiting confirmation, carrying counts once they arrive.
  const [pending, setPending] = useState(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const universe = universeSlug
    ? universeBackend.getUniverse(universeSlug)
    : universeBackend.getActiveUniverse();
  const slug = universe?.slug || null;
  const linked = universe?.gitRepo?.linkedRepo;
  const hasRepo = !!(universe?.gitRepo?.enabled && linked);

  const load = useCallback(async () => {
    if (!universe || !hasRepo) {
      setRevisions([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const history = await universeBackend.listUniverseHistory(universe, { limit: 20, withSize: true });
      setRevisions(history);
      // An empty list from a universe that HAS a repository means the listing
      // failed or the file is not committed yet — never that no versions exist.
      if (!history.length) setError('No versions found for this universe yet.');
    } catch (e) {
      setError(e?.message || 'Could not read the repository history.');
    } finally {
      setIsLoading(false);
    }
  }, [slug, hasRepo]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  /**
   * Open the confirm with what the listing already knows, then fill in the
   * counts. Waiting on a multi-megabyte download before showing anything would
   * make a tap feel broken.
   */
  const choose = async (revision) => {
    setPending({ ...revision, nodeCount: null, graphCount: null });
    try {
      const counted = await universeBackend.describeUniverseVersion(slug, revision.sha);
      setPending((current) => (
        current && current.sha === revision.sha ? { ...current, ...counted } : current
      ));
    } catch {
      // The confirm still stands on its date and size.
    }
  };

  const restore = async () => {
    if (!pending?.sha) return;
    setIsRestoring(true);
    try {
      await universeBackend.restoreUniverseVersion(slug, pending.sha, { date: pending.date });
      setPending(null);
      await load(); // The restore is itself a new commit.
    } catch (e) {
      setError(e?.message || 'Could not restore that version.');
      setPending(null);
    } finally {
      setIsRestoring(false);
    }
  };

  if (!universe) {
    return <div className="git-history-empty"><p>No universe is open.</p></div>;
  }

  if (!hasRepo) {
    return (
      <div className="git-history-empty">
        <Github size={40} opacity={0.2} />
        <p>No repository linked</p>
        <small>Link one in Universes to keep a recoverable history of this universe.</small>
      </div>
    );
  }

  return (
    <>
      <div className="git-history-bar">
        <span className="git-history-repo" title={`${linked.user}/${linked.repo}`}>
          <Github size={12} />
          <span className="git-history-repo-name">@{linked.user}/{linked.repo}</span>
        </span>
        <button
          className="git-history-refresh"
          onClick={load}
          disabled={isLoading}
          data-nav="item"
          title="Check for new versions"
        >
          <RefreshCw size={12} className={isLoading ? 'git-history-spin' : undefined} />
        </button>
      </div>

      <div className="history-list">
        {error && revisions.length === 0 ? (
          <div className="git-history-empty">
            <p>{error}</p>
            <small>Versions appear here once this universe has been saved to its repository.</small>
          </div>
        ) : (
          revisions.map((revision, index) => (
            <RevisionItem
              key={revision.sha}
              revision={revision}
              isHead={index === 0}
              isSlim={isSlim}
              onClick={() => choose(revision)}
            />
          ))
        )}
      </div>

      <RestoreVersionDialog
        isOpen={!!pending}
        universeName={universe.name || slug}
        version={pending}
        isRestoring={isRestoring}
        title="Restore this version"
        subtitle={`Saves this version of "${universe.name || slug}" as a new change. Nothing in the history is rewritten.`}
        dismissLabel="Cancel"
        onRestore={restore}
        onDismiss={isRestoring ? undefined : () => setPending(null)}
      />
    </>
  );
};

const RevisionItem = ({ revision, isHead, isSlim, onClick }) => {
  const size = formatBytes(revision.size);
  const when = formatRevisionTime(revision.date);

  return (
    <div
      className={`history-item git-revision ${isHead ? 'head' : ''}`}
      data-nav="item"
      onClick={onClick}
      title={isHead ? 'Current version in the repository' : 'Restore this version'}
    >
      <div className="history-item-icon">
        <GitCommitVertical size={14} />
      </div>
      <div className="history-item-content">
        <div className="history-item-description">{subjectOf(revision.message)}</div>
        <div className="history-item-meta">
          <span className="history-time">{when}</span>
          {size && <span className="git-revision-size">{size}</span>}
          {isHead && !isSlim && <span className="git-revision-tag">current</span>}
        </div>
      </div>
    </div>
  );
};

export default GitHistoryList;
