import React from 'react';
import { History, RotateCcw } from 'lucide-react';
import Dialog, { DialogButton, DialogCard } from './Dialog.jsx';
import { formatBytes } from '../../utils/formatBytes.js';

/**
 * A universe opened with nothing in it, but the repository still remembers.
 *
 * Every version a universe has ever had stays in the repository, so a write
 * that empties one leaves the previous content sitting in history untouched.
 * This is what makes that reachable at the moment it matters — the app notices
 * and offers, rather than waiting for someone to go looking for a feature they
 * have no reason to know exists.
 *
 * One card, because there is only one thing to decide. The counts on it are
 * the argument; restoring takes the accent because it is the recommendation.
 */

const formatCount = (value) => {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value.toLocaleString();
  }
  return '?';
};

const formatTimestamp = (timestamp) => {
  if (!timestamp) return null;
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return String(timestamp);
  }
};

/**
 * "1,822 things · 191 webs" once the revision has been opened and counted.
 *
 * Counting costs a download, so a revision picked out of the history browser
 * arrives here with only the size the commit listing already knew. Showing that
 * size beats showing a spinner or a row of question marks: it is real
 * information, and it is the column the user just chose the revision by.
 */
const versionMeta = (version) => {
  if (typeof version?.nodeCount === 'number') {
    return `${formatCount(version.nodeCount)} things · ${formatCount(version.graphCount)} webs`;
  }
  return formatBytes(version?.size) || 'Reading…';
};

const RestoreVersionDialog = ({
  isOpen,
  universeName,
  version,
  isRestoring = false,
  title = 'An earlier version has your things',
  subtitle,
  // "Keep it empty" is the honest refusal when the app raised this itself and
  // the universe in front of the user is empty. Reached deliberately from the
  // Git tab there is nothing to keep, so the caller names its own way out.
  dismissLabel = 'Keep it empty',
  onRestore,
  onDismiss
}) => (
  <Dialog
    isOpen={isOpen}
    width={520}
    onScrimClick={isRestoring ? undefined : onDismiss}
    icon={History}
    title={title}
    tone="alert"
    subtitle={subtitle ?? `"${universeName}" opened empty. Restoring saves this version as a new change.`}
    footer={(
      <>
        <DialogButton
          label={dismissLabel}
          onClick={onDismiss}
          disabled={isRestoring}
        />
        <DialogButton
          label={isRestoring ? 'Restoring…' : 'Restore'}
          icon={RotateCcw}
          tone="accent"
          onClick={onRestore}
          disabled={isRestoring || !version?.sha}
        />
      </>
    )}
  >
    <DialogCard
      icon={<History size={14} />}
      role="In the repository"
      title={formatTimestamp(version?.date) || 'Earlier version'}
      meta={versionMeta(version)}
      tone="accent"
    />
  </Dialog>
);

export default RestoreVersionDialog;
