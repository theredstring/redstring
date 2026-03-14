import React from 'react';
import {
  GitBranch,
  RefreshCw,
  Save,
  CheckCircle,
  AlertCircle,
  Clock,
  Github,
  Cloud
} from 'lucide-react';

const STATUS_COLORS = {
  success: '#2e7d32',
  warning: '#ef6c00',
  error: '#c62828',
  info: '#1565c0'
};

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

const ConnectionStats = ({ universe, syncStatus, isSlim = false }) => {
  const sync = universe.sync || {};
  const engine = sync.engine || syncStatus || {};

  const cards = [];

  cards.push({
    title: 'Sync State',
    value: sync.label || 'Unknown',
    tone: sync.tone || STATUS_COLORS.info,
    description: sync.description || '',
    icon: <GitBranch size={12} />
  });

  cards.push({
    title: 'Pending Commits',
    value: typeof sync.pendingCommits === 'number' ? sync.pendingCommits : '—',
    tone: sync.pendingCommits > 0 ? STATUS_COLORS.warning : STATUS_COLORS.success,
    description: sync.pendingCommits > 0 ? 'Changes queued for the next push.' : 'Working tree clean.',
    icon: sync.pendingCommits > 0 ? <RefreshCw size={12} /> : <Save size={12} />
  });

  // Explicit unsaved-changes indicator (includes engine.hasChanges or pending commits)
  const unsaved = !!(sync.hasUnsavedChanges || engine.hasChanges || (sync.pendingCommits > 0));
  cards.push({
    title: 'Unsaved Changes',
    value: unsaved ? 'Yes' : 'No',
    tone: unsaved ? STATUS_COLORS.warning : STATUS_COLORS.success,
    description: unsaved ? 'There are edits not yet committed to Git.' : 'All changes are persisted.',
    icon: unsaved ? <RefreshCw size={12} /> : <CheckCircle size={12} />
  });

  cards.push({
    title: 'Engine Health',
    value: sync.isHealthy === false ? 'Degraded' : (sync.isHealthy === true ? 'Healthy' : 'Unknown'),
    tone: sync.isHealthy === true ? STATUS_COLORS.success : (sync.isHealthy === false ? STATUS_COLORS.error : STATUS_COLORS.info),
    description: sync.isInBackoff ? 'Engine is backing off after repeated failures.' : (sync.isHealthy === true ? 'Background commits available.' : 'Monitoring background sync status.'),
    icon: sync.isHealthy === true ? <CheckCircle size={12} color={STATUS_COLORS.success} /> : <AlertCircle size={12} color={sync.isHealthy === false ? STATUS_COLORS.error : STATUS_COLORS.warning} />
  });

  cards.push({
    title: 'Last Sync',
    value: sync.lastSync ? formatWhen(sync.lastSync) : 'Never',
    tone: STATUS_COLORS.info,
    description: engine.lastCommitTime ? `Last commit at ${formatWhen(engine.lastCommitTime)}` : 'No commits recorded yet.',
    icon: <Clock size={12} />
  });

  const localFile = universe.raw?.localFile;
  if (localFile?.enabled) {
    const localConnected = localFile.fileHandleStatus === 'connected' || localFile.hadFileHandle;
    cards.push({
      title: 'Local File',
      value: localFile.lastSaved ? formatWhen(localFile.lastSaved) : 'Never',
      tone: localFile.lastSaved ? STATUS_COLORS.info : STATUS_COLORS.warning,
      description: localConnected
        ? 'Autosave to local disk is active.'
        : 'Pick or reconnect a file handle to enable autosave.',
      icon: <Save size={12} />
    });
  }

  cards.push({
    title: 'Source of Truth',
    value: universe.sync?.sourceOfTruth || universe.sourceOfTruth || 'unknown',
    tone: universe.sourceOfTruth === 'git' ? STATUS_COLORS.success : universe.sourceOfTruth === 'local' ? STATUS_COLORS.warning : STATUS_COLORS.info,
    description: universe.sourceOfTruth === 'git'
      ? 'Git repository is primary.'
      : universe.sourceOfTruth === 'local'
        ? 'Local file is primary. Git operates as backup.'
        : 'Browser cache currently holds the latest state.',
    icon: universe.sourceOfTruth === 'git'
      ? <Github size={12} />
      : universe.sourceOfTruth === 'local'
        ? <Save size={12} />
        : <Cloud size={12} />
  });

  if (sync.consecutiveErrors > 0) {
    cards.push({
      title: 'Error Count',
      value: sync.consecutiveErrors,
      tone: STATUS_COLORS.error,
      description: sync.lastErrorTime ? `Last error at ${formatWhen(sync.lastErrorTime)}` : 'Recent sync errors detected.',
      icon: <AlertCircle size={12} color={STATUS_COLORS.error} />
    });
  }

  return (
    <div style={{ display: 'grid', gap: 5, gridTemplateColumns: isSlim ? '1fr' : 'repeat(auto-fit, minmax(140px, 1fr))' }}>
      {cards.map((card, idx) => (
        <div
          key={`${card.title}-${idx}`}
          style={{
            border: `1px solid ${card.tone}`,
            backgroundColor: 'rgba(255,255,255,0.3)',
            borderRadius: 6,
            padding: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minHeight: 56
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '0.68rem', color: '#260000', fontWeight: 700 }}>{card.title}</div>
            {card.icon || null}
          </div>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: card.tone }}>{card.value}</div>
          {card.description && (
            <div style={{ fontSize: '0.63rem', color: '#444', lineHeight: 1.2 }}>{card.description}</div>
          )}
        </div>
      ))}
    </div>
  );
};

export default ConnectionStats;
