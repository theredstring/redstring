import ConfirmDialog from '../../shared/ConfirmDialog.jsx';
import { useCanvasDialogStore, setDeleteDefinitionDialog } from './canvasDialogs.js';
import { describeDefinitionDeletion, deleteDefinition } from './deleteDefinition.js';

/** The "delete this definition?" confirmation. Opened by requestDeleteDefinition. */
export default function DeleteDefinitionDialog() {
  const request = useCanvasDialogStore((s) => s.deleteDefinitionDialog);
  if (!request) return null;
  const info = describeDefinitionDeletion(request.prototypeId, request.graphId);
  if (!info) return null;

  const which = info.total > 1 ? `definition ${info.number} of ${info.total}` : 'the only definition';
  const web = info.webName ? `"${info.webName}", ` : '';
  const contents = info.componentCount > 0
    ? `Its Web and the ${info.componentCount} Thing${info.componentCount === 1 ? '' : 's'} placed in it will be removed.`
    : 'Its Web is empty.';
  const details = info.sharedWith > 0
    ? `The Web stays, because ${info.sharedWith === 1 ? 'another Thing uses' : `${info.sharedWith} other Things use`} it as a definition too. You can undo this.`
    : `${contents} You can undo this.`;

  return (
    <ConfirmDialog
      isOpen={true}
      onClose={() => setDeleteDefinitionDialog(null)}
      onConfirm={() => deleteDefinition(request.prototypeId, request.graphId)}
      title="Delete Definition?"
      message={`Delete ${web}${which} of "${info.nodeName}"?`}
      details={details}
      confirmLabel="Delete"
      cancelLabel="Cancel"
      variant="danger"
    />
  );
}
