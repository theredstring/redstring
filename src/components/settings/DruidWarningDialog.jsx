import ConfirmDialog from '../shared/ConfirmDialog.jsx';

/**
 * The warning before the Druid is switched on (Settings › Debug › Features).
 *
 * The Druid is off by default and stays off until this is confirmed: it is an
 * early experiment that writes into whatever universe is open. Shared with the
 * dialog gallery, so the preview there is the text people actually see.
 */
const DruidWarningDialog = ({ isOpen, onConfirm, onCancel, onClose }) => (
  <ConfirmDialog
    isOpen={isOpen}
    variant="warning"
    title="The Druid is experimental"
    message="It isn't recommended for use right now. It is unfinished, it can be slow, and it writes into whatever universe is open, so give it one of its own."
    details="But it is pretty cool."
    confirmLabel="Turn It On"
    cancelLabel="Not Now"
    onConfirm={onConfirm}
    onCancel={onCancel}
    onClose={onClose}
  />
);

export default DruidWarningDialog;
