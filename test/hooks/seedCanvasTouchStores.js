// useCanvasTouch subscribes to its store-backed inputs itself (P4.06), so a test
// that drives it through props also has to put those values in the stores.
// Setters go in as-is, so spies passed in props still see the calls.
import useGraphStore from '../../src/store/graphStore.js';
import useCanvasUIStore from '../../src/store/canvasUIStore.js';

const UI_FIELDS = [
  'selectedInstanceIds', 'setSelectedInstanceIds', 'selectedEdgeId', 'selectedEdgeIds', 'nodeNamePrompt',
  'previewingNodeId', 'selectedNodeIdForPieMenu', 'groupControlPanelShouldShow', 'groupControlPanelVisible',
  'setGroupControlPanelVisible', 'connectionControlPanelShouldShow', 'connectionControlPanelVisible',
  'setConnectionControlPanelVisible',
];

export function seedTouchStores(props) {
  if ('activeGraphId' in props) useGraphStore.setState({ activeGraphId: props.activeGraphId });
  const patch = {};
  for (const k of UI_FIELDS) if (k in props) patch[k] = props[k];
  useCanvasUIStore.setState(patch);
}
