import React from 'react';
import { AlertTriangle, HardDrive, FileCode } from 'lucide-react';
import Dialog, { DialogButton, DialogCard } from './Dialog.jsx';

/**
 * More than one local file claims to be the same universe — which one is the
 * source of truth from here on?
 *
 * Same shape as SlotConflictDialog: two cards, each with the action that picks
 * it. This one keeps a Cancel in the footer because backing out is a real
 * answer here — the link can simply be left alone.
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

const optionMeta = (option) => [
  `${formatCount(option?.nodeCount)} nodes`,
  `${formatCount(option?.edgeCount)} edges`,
  formatTimestamp(option?.lastSaved ?? option?.fileModified)
].filter(Boolean).join(' · ');

const LocalFileConflictDialog = ({
  isOpen,
  universeName,
  existingOption,
  incomingOption,
  onChooseExisting,
  onOverwrite,
  onCancel
}) => (
  <Dialog
    isOpen={isOpen}
    width={520}
    onScrimClick={onCancel}
    icon={AlertTriangle}
    tone="alert"
    title="Resolve Local File Conflict"
    subtitle={`We found multiple local files associated with "${universeName}". Choose which file should act as the source of truth going forward.`}
    footer={<DialogButton label="Cancel" onClick={onCancel} />}
  >
    <DialogCard
      icon={<HardDrive size={14} />}
      role={existingOption?.role}
      title={existingOption?.displayPath || existingOption?.fileName || 'Unknown'}
      meta={optionMeta(existingOption)}
      actionLabel="Keep Existing File"
      onSelect={onChooseExisting}
    />
    <DialogCard
      icon={<FileCode size={14} />}
      role={incomingOption?.role}
      title={incomingOption?.displayPath || incomingOption?.fileName || 'Unknown'}
      meta={optionMeta(incomingOption)}
      actionLabel="Use Linked File"
      actionTone="accent"
      onSelect={onOverwrite}
      tone="accent"
    />
  </Dialog>
);

export default LocalFileConflictDialog;
