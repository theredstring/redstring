import React from 'react';
import { AlertTriangle, HardDrive, GitBranch } from 'lucide-react';
import Dialog, { DialogButton, DialogCard } from './Dialog.jsx';
import { formatBytes } from '../../utils/formatBytes.js';

/**
 * A universe is past what Git can carry in one file (GIT_WRITE_CAP_BYTES,
 * just under GitHub's 100 MB wall).
 *
 * Two moments, one dialog:
 *   'save'  sync just paused. Nothing is lost: this device (its file, or
 *           browser storage when there is none) keeps every change, and the
 *           repository keeps the last copy that fit.
 *   'open'  the repository's copy is over the limit, so this device refused
 *           to download it. Nothing was changed on either side.
 *
 * Shown once per event; the status line carried this alone before, and was
 * easy to miss right up until another device opened the older copy.
 */

const GitTooLargeDialog = ({
  isOpen,
  universeName,
  phase = 'save',
  bytes,
  limit,
  hasLocalFile = false,
  onDismiss
}) => {
  const size = formatBytes(bytes);
  const cap = formatBytes(limit);
  const opening = phase === 'open';
  // "is 97.2 MB, over the 95.0 MB" when the sizes are known, "is over the limit" when not.
  const over = `${size ? ` is ${size}, over` : ' is over'} the ${cap || 'limit'}`;

  const subtitle = opening
    ? `The repository's copy of "${universeName}"${over} Git sync can open. Nothing was changed.`
    : `"${universeName}"${over} Git sync can carry. Saving to Git is paused until it is smaller.`;

  return (
    <Dialog
      isOpen={isOpen}
      width={520}
      onScrimClick={onDismiss}
      icon={AlertTriangle}
      tone="alert"
      title="Too large for Git"
      subtitle={subtitle}
      footer={<DialogButton label="OK" tone="accent" onClick={onDismiss} />}
    >
      {opening ? (
        <DialogCard
          icon={<GitBranch size={14} />}
          role="In the repository"
          title="Left as it is"
          meta="Open it from a local .redstring file, or make it smaller on the device that grew it."
        />
      ) : (
        <>
          <DialogCard
            icon={<HardDrive size={14} />}
            role="On this device"
            title={hasLocalFile ? 'Your file keeps every change' : 'This device keeps every change'}
            meta="Keep working as usual. Sync resumes on its own once the universe fits."
            tone="accent"
          />
          <DialogCard
            icon={<GitBranch size={14} />}
            role="In the repository"
            title="The last copy that fit"
            meta="Other devices open this older copy until sync resumes."
          />
        </>
      )}
    </Dialog>
  );
};

export default GitTooLargeDialog;
