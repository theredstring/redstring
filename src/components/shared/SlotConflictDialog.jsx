import React from 'react';
import { AlertTriangle, Save, Github } from 'lucide-react';
import Dialog, { DialogCard } from './Dialog.jsx';

/**
 * One universe, two copies that disagree: the local file and the git remote.
 *
 * The choice IS the content, so each side is a DialogCard whose action pill
 * spans it. Git takes the accent because it is the shared copy — picking local
 * is picking the one only this device has seen.
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

/** "518 nodes · 59 graphs · 3/4/2026, 11:02" with the parts that are missing dropped. */
const slotMeta = (slot) => [
  `${formatCount(slot?.nodeCount)} nodes`,
  `${formatCount(slot?.graphCount)} graphs`,
  formatTimestamp(slot?.timestamp)
].filter(Boolean).join(' · ');

const SlotConflictDialog = ({
  isOpen,
  universeName,
  localSlot,
  gitSlot,
  onChooseLocal,
  onChooseGit,
  onCancel
}) => (
  <Dialog
    isOpen={isOpen}
    width={520}
    onScrimClick={onCancel}
    icon={AlertTriangle}
    title="Data Conflict Detected"
    titleTone="accent"
    subtitle={`The local file and Git repository for "${universeName}" have different data. Choose which version to keep.`}
  >
    <DialogCard
      icon={<Save size={14} />}
      role="Local File"
      title={localSlot?.path}
      meta={slotMeta(localSlot)}
      actionLabel="Use Local File"
      onSelect={onChooseLocal}
    />
    <DialogCard
      icon={<Github size={14} />}
      role={gitSlot?.repoLabel || 'Git Repository'}
      title={gitSlot?.path}
      meta={slotMeta(gitSlot)}
      actionLabel="Use Git Version"
      actionTone="accent"
      onSelect={onChooseGit}
      tone="accent"
    />
  </Dialog>
);

export default SlotConflictDialog;
