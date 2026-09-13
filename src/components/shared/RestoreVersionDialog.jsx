import React from 'react';
import { History, RotateCcw } from 'lucide-react';
import Dialog, { DialogButton, DialogCard } from './Dialog.jsx';

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

/** "1,822 things · 191 webs" with the parts that are missing dropped. */
const versionMeta = (version) => [
  `${formatCount(version?.nodeCount)} things`,
  `${formatCount(version?.graphCount)} webs`
].filter(Boolean).join(' · ');

const RestoreVersionDialog = ({
  isOpen,
  universeName,
  version,
  isRestoring = false,
  onRestore,
  onDismiss
}) => (
  <Dialog
    isOpen={isOpen}
    width={520}
    onScrimClick={isRestoring ? undefined : onDismiss}
    icon={History}
    title="An earlier version has your things"
    tone="alert"
    subtitle={`"${universeName}" opened empty. Restoring saves this version as a new change.`}
    footer={(
      <>
        <DialogButton
          label="Keep it empty"
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
