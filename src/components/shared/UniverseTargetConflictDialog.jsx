import React from 'react';
import { AlertTriangle, FolderTree } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import Dialog, { DialogCard } from './Dialog.jsx';

/**
 * Two or more universes are configured to write the SAME file.
 *
 * Distinct from SlotConflictDialog, which asks "local or git?" about one
 * universe's two copies. This one asks "which universe owns this path?" —
 * the failure where slug dedup produced `ii` and `ii-2` while both wrote
 * `universes/ii/ii.redstring`, so each one's guard state described only its own
 * history and an empty universe overwrote a populated one.
 *
 * Saves are blocked for every universe involved until this is answered, so the
 * dialog is a stop sign, not a notice. It deliberately does not preselect a
 * winner: the app cannot know which universe the user thinks of as the real
 * one, and guessing is how the wrong one keeps the data. That is also why no
 * claimant card takes the accent — an accent here would be a recommendation.
 */

const formatCount = (value) =>
  (typeof value === 'number' && !Number.isNaN(value)) ? value.toLocaleString() : '?';

const UniverseTargetConflictDialog = ({
  isOpen,
  targetPath,
  claimants = [],
  onKeep,
  onCancel
}) => {
  const theme = useTheme();

  return (
    <Dialog
      isOpen={isOpen}
      width={520}
      onScrimClick={onCancel}
      icon={AlertTriangle}
      title="Two universes, one file"
      titleTone="accent"
      subtitle="These universes all save to the same file, so each one overwrites the others. Saving is paused for all of them until you pick which keeps it — the rest move to their own file."
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        color: theme.canvas.textSecondary,
        fontSize: '0.78rem',
        minWidth: 0
      }}>
        <FolderTree size={14} style={{ flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {targetPath}
        </span>
      </div>

      {claimants.map((universe) => (
        <DialogCard
          key={universe.slug}
          role={universe.slug}
          title={universe.name || universe.slug}
          meta={`${formatCount(universe.nodeCount)} things · ${formatCount(universe.graphCount)} webs`}
          actionLabel="This one keeps the file"
          actionDisabled={claimants.length < 2}
          onSelect={() => onKeep(universe.slug)}
        />
      ))}
    </Dialog>
  );
};

export default UniverseTargetConflictDialog;
