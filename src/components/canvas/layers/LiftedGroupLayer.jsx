/**
 * The lifted Thing-group (groupLift.js), drawn over the whole canvas while it
 * is dragged: its shells, nested groups and connections in the same z-slot
 * order the ground uses, then its Things and formulas, then its titles. Every
 * ordinary layer skips what this draws, so nothing is drawn twice.
 */
import EdgeLayer from './EdgeLayer.jsx';
import NodeLayer from './NodeLayer.jsx';

/**
 * @param {object} p
 * @param {object|null} p.lift  the lifted group, or null (draws nothing)
 * @param {{ backgroundsByDepth: Map, titles: Array, nestedRegularByDepth: Map }} p.groups
 *   groupElements.lifted
 * @param {object} p.edgeProps  EdgeLayer's ctx, visibleEdges, edgeZSlots and edgePerfRef
 * @param {object} p.nodeLayerProps  NodeLayer's props, as the ground's instances get them
 */
export default function LiftedGroupLayer({ lift, groups, edgeProps, nodeLayerProps }) {
  if (!lift) return null;
  return (
    <g className="lifted-group-layer">
      <EdgeLayer
        {...edgeProps} lift={lift} lifted
        nodeGroupShellsByDepth={groups.backgroundsByDepth} nestedRegularGroupsByDepth={groups.nestedRegularByDepth}
      />
      <NodeLayer {...nodeLayerProps} part="lifted" />
      {groups.titles}
    </g>
  );
}
