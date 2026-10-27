/**
 * Converting a node into a node-group of its definition: its definition opened
 * in place on it (see expandInPlace), then selected. NodeCanvas passes the
 * render values it used as `ctx`.
 */
import { expandNodeInPlace } from './expandInPlace.js';

export function convertNodeToNodeGroup(instanceId, prototypeId, definitionGraphId, ctx) {
  const {
    activeGraphId, nodePrototypesMap, setGroupControlPanelShouldShow, setNodeControlPanelShouldShow,
    setNodeControlPanelVisible, setPreviewingNodeId, setSelectedGroup, setSelectedInstanceIds,
  } = ctx;
  if (!activeGraphId) return;

  const definitionIndex = Math.max(0, nodePrototypesMap.get(prototypeId)?.definitionGraphIds?.indexOf(definitionGraphId) ?? 0);
  const openGroup = expandNodeInPlace({ viewGraphId: activeGraphId, definitionIndex, instanceId });
  if (!openGroup) return;
  setSelectedGroup(openGroup);
  setSelectedInstanceIds(new Set());
  setPreviewingNodeId(null);
  setGroupControlPanelShouldShow(true);
  setNodeControlPanelShouldShow(false);
  setNodeControlPanelVisible(false);
}
