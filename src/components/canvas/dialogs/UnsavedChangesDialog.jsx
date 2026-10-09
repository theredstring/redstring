import { useEffect } from 'react';
import { Save } from 'lucide-react';
import Dialog, { DialogButton } from '../../shared/Dialog.jsx';
import { useTheme } from '../../../hooks/useTheme.js';
import { useCanvasDialogStore } from './canvasDialogs.js';
import { answerUnsavedChanges, setUnsavedChangesDialogMounted } from './unsavedChanges.js';

/** "Save changes?" before closing or switching with autosave off. Opened by settleUnsavedChanges. */
export default function UnsavedChangesDialog() {
  const theme = useTheme();
  const request = useCanvasDialogStore((s) => s.unsavedChangesDialog);

  useEffect(() => {
    setUnsavedChangesDialogMounted(true);
    return () => setUnsavedChangesDialogMounted(false);
  }, []);

  if (!request) return null;
  const cancel = () => answerUnsavedChanges('cancel');

  return (
    <Dialog
      onScrimClick={cancel}
      icon={Save}
      title="Save changes?"
      footer={
        <>
          <DialogButton label="Don't Save" onClick={() => answerUnsavedChanges('discard')} />
          <DialogButton label="Cancel" onClick={cancel} />
          <DialogButton label="Save" tone="accent" onClick={() => answerUnsavedChanges('save')} />
        </>
      }
    >
      <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.5, color: theme.canvas.textPrimary }}>
        {request.action === 'switch'
          ? 'This universe has changes that aren’t saved. Save them before switching?'
          : 'This universe has changes that aren’t saved. Save them before Redstring closes?'}
      </p>
    </Dialog>
  );
}
