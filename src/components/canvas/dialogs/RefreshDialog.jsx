import ConfirmDialog from '../../shared/ConfirmDialog.jsx';
import { useCanvasDialogStore, setRefreshDialog } from './canvasDialogs.js';
import { describeRefresh, listWebNames, refreshNow } from './refresh.js';

/** The "refresh Redstring?" confirmation. Opened by requestRefresh. */
export default function RefreshDialog() {
  const request = useCanvasDialogStore((s) => s.refreshDialog);
  if (!request) return null;
  const { unbookmarkedWebs, stillSaving } = describeRefresh();

  const count = unbookmarkedWebs.length;
  const webs = count === 1
    ? `${listWebNames(unbookmarkedWebs)} isn't bookmarked.`
    : count > 1
      ? `${count} open webs aren't bookmarked: ${listWebNames(unbookmarkedWebs)}.`
      : null;
  const notes = [
    stillSaving
      ? 'Your latest changes are still saving. Refreshing now could lose them, and a web that isn\'t bookmarked could be cleaned up with them.'
      : null,
    webs
      ? `${webs} Webs that aren't bookmarked are only kept while they're open, so they could be cleaned up. Bookmark the ones you want to keep.`
      : null,
  ].filter(Boolean);

  return (
    <ConfirmDialog
      isOpen={true}
      onClose={() => setRefreshDialog(null)}
      onConfirm={refreshNow}
      title="Refresh Redstring?"
      message="Redstring will reload and reopen this universe."
      details={notes.length ? notes.join('\n\n') : undefined}
      confirmLabel="Refresh"
      cancelLabel="Cancel"
      variant={stillSaving ? 'warning' : 'default'}
    />
  );
}
