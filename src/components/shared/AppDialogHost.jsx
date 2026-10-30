import React, { useEffect } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import Dialog, { DialogButton, DialogNote } from './Dialog.jsx';
import { useAppDialogStore, setAppDialogHostMounted, answerAppDialog } from './appDialogs.js';

/**
 * Renders askConfirm / showNotice (appDialogs.js), one at a time, front of the
 * queue first. Mounted once by App, at the top of #root, so it works over the
 * canvas, the panels and Settings alike.
 *
 * Settings sits at z-index 20201 and dialogs ask for 20001, so this takes a
 * stacking context above both (as DebugSection's warnings do). It stays inside
 * #root rather than portalling to <body>, so the scrim keeps #root's safe-area
 * containing block on a phone.
 */
const NoticeDialog = ({ request }) => {
  const theme = useTheme();
  const dismiss = () => answerAppDialog(request.id);
  return (
    <Dialog
      onScrimClick={dismiss}
      icon={request.variant === 'error' ? AlertTriangle : Info}
      tone={request.variant === 'error' ? 'alert' : 'neutral'}
      title={request.title}
      footer={<DialogButton label={request.confirmLabel || 'OK'} tone="primary" onClick={dismiss} />}
    >
      {request.message && (
        <p
          style={{
            margin: 0,
            fontSize: '0.9rem',
            lineHeight: 1.5,
            color: theme.canvas.textPrimary,
            whiteSpace: 'pre-wrap'
          }}
        >
          {request.message}
        </p>
      )}
      {request.details && <DialogNote>{request.details}</DialogNote>}
    </Dialog>
  );
};

const AppDialogHost = () => {
  const request = useAppDialogStore((s) => s.queue[0] || null);

  useEffect(() => {
    setAppDialogHostMounted(true);
    return () => {
      setAppDialogHostMounted(false);
      // Nobody left to answer: settle what is waiting the way an unmounted
      // host would have (confirm false, notice dismissed).
      for (const r of useAppDialogStore.getState().queue) answerAppDialog(r.id, false);
    };
  }, []);

  if (!request) return null;

  return (
    <div style={{ position: 'relative', zIndex: 30000 }}>
      {request.kind === 'confirm' ? (
        <ConfirmDialog
          key={request.id}
          isOpen
          title={request.title}
          message={request.message}
          details={request.details}
          confirmLabel={request.confirmLabel}
          cancelLabel={request.cancelLabel}
          variant={request.variant}
          onConfirm={() => answerAppDialog(request.id, true)}
          // Also called after onConfirm; the first answer stands.
          onClose={() => answerAppDialog(request.id, false)}
        />
      ) : (
        <NoticeDialog key={request.id} request={request} />
      )}
    </div>
  );
};

export default AppDialogHost;
