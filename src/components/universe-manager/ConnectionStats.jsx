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
import { useTheme } from '../../hooks/useTheme.js';

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
  const theme = useTheme();
  
  const STATUS_COLORS = {
    success: theme.darkMode ? '#E7E79E' : '#354702',
    warning: theme.darkMode ? '#b39ddb' : '#512da8', // Purple variants to replace the previous orange
    error: theme.darkMode ? '#C09191' : '#7A0000',
    info: theme.darkMode ? '#64b5f6' : '#1565c0'
  };

  const sync = universe.sync || {};
  const engine = sync.engine || syncStatus || {};

  const cards = [];

  cards.push({
    title: 'Sync State',
    value: sync.label || 'Unknown',
    tone: sync.tone || STATUS_COLORS.info,
    description: sync.description || '',
    icon: <GitBranch />
  });

  cards.push({
    title: 'Pending Commits',
    value: typeof sync.pendingCommits === 'number' ? sync.pendingCommits : '—',
    tone: sync.pendingCommits > 0 ? STATUS_COLORS.warning : STATUS_COLORS.success,
    description: sync.pendingCommits > 0 ? 'Changes queued for the next push.' : 'Working tree clean.',
    icon: sync.pendingCommits > 0 ? <RefreshCw /> : <Save />
  });

  // Explicit unsaved-changes indicator (includes engine.hasChanges or pending commits)
  const unsaved = !!(sync.hasUnsavedChanges || engine.hasChanges || (sync.pendingCommits > 0));
  cards.push({
    title: 'Unsaved Changes',
    value: unsaved ? 'Yes' : 'No',
    tone: unsaved ? STATUS_COLORS.warning : STATUS_COLORS.success,
    description: unsaved ? 'There are edits not yet committed to Git.' : 'All changes are persisted.',
    icon: unsaved ? <RefreshCw /> : <CheckCircle />
  });

  cards.push({
    title: 'Engine Health',
    value: sync.isHealthy === false ? 'Degraded' : (sync.isHealthy === true ? 'Healthy' : 'Unknown'),
    tone: sync.isHealthy === true ? STATUS_COLORS.success : (sync.isHealthy === false ? STATUS_COLORS.error : STATUS_COLORS.info),
    description: sync.isInBackoff ? 'Engine is backing off after repeated failures.' : (sync.isHealthy === true ? 'Background commits available.' : 'Monitoring background sync status.'),
    icon: sync.isHealthy === true ? <CheckCircle /> : <AlertCircle />
  });

  cards.push({
    title: 'Last Sync',
    value: sync.lastSync ? formatWhen(sync.lastSync) : 'Never',
    tone: STATUS_COLORS.info,
    description: engine.lastCommitTime ? `Last commit at ${formatWhen(engine.lastCommitTime)}` : 'No commits recorded yet.',
    icon: <Clock />
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
      icon: <Save />
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
      ? <Github />
      : universe.sourceOfTruth === 'local'
        ? <Save />
        : <Cloud />
  });

  if (sync.consecutiveErrors > 0) {
    cards.push({
      title: 'Error Count',
      value: sync.consecutiveErrors,
      tone: STATUS_COLORS.error,
      description: sync.lastErrorTime ? `Last error at ${formatWhen(sync.lastErrorTime)}` : 'Recent sync errors detected.',
      icon: <AlertCircle />
    });
  }

  return (
    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: isSlim ? '1fr' : 'repeat(auto-fit, minmax(180px, 1fr))' }}>
      {cards.map((card, idx) => (
        <div
          key={`${card.title}-${idx}`}
          style={{
            border: `1px solid ${theme.canvas.border}`,
            backgroundColor: theme.canvas.bg,
            borderRadius: 8,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: card.tone }}>
            {card.icon ? React.cloneElement(card.icon, { size: 18, strokeWidth: 2.5 }) : null}
            <div style={{ fontSize: '0.9rem', fontWeight: 800 }}>{card.value}</div>
          </div>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: theme.canvas.textPrimary }}>{card.title}</div>
          {card.description && (
            <div style={{ fontSize: '0.65rem', color: theme.canvas.textSecondary, lineHeight: 1.3 }}>{card.description}</div>
          )}
        </div>
      ))}
    </div>
  );
};

export default ConnectionStats;
