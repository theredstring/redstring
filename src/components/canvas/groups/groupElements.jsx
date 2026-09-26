/**
 * Group elements (P3.04): the groups pass of NodeCanvas's JSX, as a function of
 * the layouts (P3.03a) and the few display inputs it reads. NodeCanvas memoizes
 * the result, so a render that changes nothing about groups hands React the
 * same elements and it skips them.
 *
 * Regular groups draw at the bottom of the stack (`regular`). Node-group shells
 * (`backgroundsByDepth`) and nested regular groups (`nestedRegularByDepth`)
 * interleave with connections by depth, and node-group titles (`titles`) draw
 * above member nodes; NodeCanvas places those.
 *
 * Input goes through the stable `handlers` from createGroupInputHandlers.
 * The markup is the groups pass, moved verbatim.
 */
import { GROUP_LAYOUT_CONSTANTS } from '../../../services/groupLayout.js';
import { getTextColor, blendColors } from '../../../utils/colorUtils.js';

// Node-group interiors take this much of the group colour over the canvas.
export const NODE_GROUP_INTERIOR_TINT = 0.07;

export function buildGroupElements({
  groupLayouts, groupDepths, draggingGroupId, editingGroupId, tempGroupName,
  theme, gridActive, gridPatternId, groupEditInputRef, handlers,
}) {
  const { entries: groupEntries, groupCount, groupLabelScale, groupLabelFontSize } = groupLayouts;
  const ngBackgroundsByDepth = new Map();
  const ngTitles = [];
  const pushAtDepth = (map, depth, element) => {
    let bucket = map.get(depth);
    if (!bucket) { bucket = []; map.set(depth, bucket); }
    bucket.push(element);
  };
  const pushBackgroundAtDepth = (depth, element) => pushAtDepth(ngBackgroundsByDepth, depth, element);
  // Nested plain groups (depth > 0). They live inside an opaque
  // node-group shell, so emitting them with the depth-0 ones at the
  // bottom of the stack would bury them. Bucketed by depth and
  // interleaved with the shells instead — see Phase 2.
  const nestedRegularByDepth = new Map();
  const result = {
    regular: null, backgroundsByDepth: ngBackgroundsByDepth, titles: ngTitles,
    nestedRegularByDepth,
  };
  if (!groupCount) return result;

  const regularGroupElements = [];

  // Downstream JSX still references GROUP_SPACING (e.g. innerCanvasBorder
  // for the inner-canvas inset rect). Keep an alias.
  const GROUP_SPACING = GROUP_LAYOUT_CONSTANTS;

  groupEntries.forEach(({ group, members, layout, effectiveGroupName, effectiveGroupColor }) => {
    const { rect, label, nodeGroupRect, innerCanvasY, isNodeGroup } = layout;
    const entry = { group, members, isNodeGroup, effectiveGroupName };
    const rectX = rect.x, rectY = rect.y, rectW = rect.w, rectH = rect.h;
    const labelX = label.x, labelY = label.y;
    const labelWidth = label.w, labelHeight = label.h;
    const nodeGroupRectY = nodeGroupRect.y, nodeGroupRectH = nodeGroupRect.h;

    const nodeGroupCornerR = GROUP_LAYOUT_CONSTANTS.nodeGroupCornerRadius;
    const strokeColor = effectiveGroupColor;
    const fontSize = groupLabelFontSize;

    const labelText = effectiveGroupName;
    // Wrapped lines from the same box the layout measured, so the
    // drawn text can never be wider than the tab it sits in.
    const labelLines = label.lines?.length ? label.lines : [labelText];
    const labelLineHeight = fontSize * GROUP_LAYOUT_CONSTANTS.titleLineSpacingFactor;
    const isGroupDragging = draggingGroupId === group.id;

    const nodeGroupColor = effectiveGroupColor;

    if (typeof window !== 'undefined' && window.__groupBoundsDebug) {
      console.log('[GROUP-STATIC]', {
        groupId: group.id,
        name: group.name,
        isNodeGroup,
        memberIdsInStore: group.memberInstanceIds,
        membersResolved: members.map(m => ({ id: m.id, x: Math.round(m.x), y: Math.round(m.y) })),
        droppedFromHydration: layout.droppedOrphanIds,
        anchorInstanceId: group.anchorInstanceId || null,
        bbox: { minX: Math.round(layout.bbox.minX), minY: Math.round(layout.bbox.minY), maxX: Math.round(layout.bbox.maxX), maxY: Math.round(layout.bbox.maxY) },
        rect: { x: Math.round(rectX), y: Math.round(rectY), w: Math.round(rectW), h: Math.round(rectH) },
        nodeGroupRect: { y: Math.round(nodeGroupRectY), h: Math.round(nodeGroupRectH) },
        label: { x: Math.round(labelX), y: Math.round(labelY), w: Math.round(labelWidth), h: Math.round(labelHeight) },
        nestedContributors: layout.nestedContributors,
      });
    }

    const groupScale = isGroupDragging ? 1.05 : 1;
    const centerX = rectX + rectW / 2;
    const centerY = rectY + rectH / 2;
    const groupTransform = isGroupDragging
      ? `translate(${centerX}, ${centerY}) scale(${groupScale}) translate(${-centerX}, ${-centerY})`
      : '';

    const groupStyle = {
      transform: groupTransform,
      transformOrigin: `${centerX}px ${centerY}px`,
      transition: isGroupDragging ? 'none' : 'transform 0.2s ease-out',
      filter: isGroupDragging ? 'drop-shadow(0px 8px 16px rgba(0,0,0,0.3))' : 'none'
    };

    const groupDepth = groupDepths.get(group.id) ?? 0;

    // Lift-scale for the title pill + text while dragging: an explicit
    // centered matrix on the `transform` ATTRIBUTE (local user space), NOT
    // CSS transform-box:fill-box (which + the drag drop-shadow filter clips
    // the pill stroke). Both share this so the text pops with the pill.
    // During an active drag the pivot is re-centered per-frame in useNodeDrag.
    const groupLiftCx = labelX + labelWidth / 2;
    const groupLiftCy = labelY + labelHeight / 2;
    const groupLiftTransform = isGroupDragging
      ? `translate(${groupLiftCx} ${groupLiftCy}) scale(1.08) translate(${-groupLiftCx} ${-groupLiftCy})`
      : undefined;

    // --- Build JSX for the title label (shared between regular and thing groups) ---
    const titleLabel = (
      <g className="group-label" style={{ cursor: 'pointer' }}
        onClick={(e) => handlers.titleClick(e, entry)}
        onMouseDown={(e) => handlers.titleMouseDown(e, entry)}
        onMouseUp={() => handlers.titleMouseUp(entry)}
        onMouseLeave={handlers.titleMouseLeave}
        onTouchStart={(e) => handlers.titleTouchStart(e, entry)}
        onTouchEnd={(e) => handlers.titleTouchEnd(e, entry)}
        onTouchCancel={() => handlers.titleTouchCancel(entry)}
      >
        <rect x={labelX} y={labelY} width={labelWidth} height={labelHeight} rx={20 * groupLabelScale} ry={20 * groupLabelScale}
          fill={isNodeGroup ? "none" : theme.canvas.bg}
          stroke={isNodeGroup ? "none" : strokeColor}
          strokeWidth={isNodeGroup ? 0 : 6 * groupLabelScale}
          pointerEvents="all"
          transform={groupLiftTransform}
        />
        {editingGroupId === group.id ? (
          <foreignObject x={labelX} y={labelY} width={labelWidth} height={labelHeight}
            style={{ pointerEvents: 'auto' }}>
            <div style={{
              width: '100%', height: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxSizing: 'border-box'
            }}>
              {/* textarea, not input: the tab wraps long names, and a
                  single-line field would scroll its text sideways out
                  of a box that is already the right shape for it. */}
              <textarea
                ref={groupEditInputRef}
                rows={labelLines.length}
                value={tempGroupName}
                onChange={handlers.renameChange}
                onKeyDown={(e) => handlers.renameKeyDown(e, entry)}
                onBlur={() => handlers.renameBlur(entry)}
                autoFocus
                style={{
                  width: `calc(100% - ${GROUP_LAYOUT_CONSTANTS.titlePaddingHorizontal * 2 * groupLabelScale}px)`,
                  // Exactly its own lines tall, then centred by the flex
                  // parent — a textarea won't centre its text the way the
                  // <input> this replaced did, so it would ride high in a
                  // box whose one-line interior is taller than one line box.
                  height: `${labelLines.length * labelLineHeight}px`,
                  margin: `0 ${GROUP_LAYOUT_CONSTANTS.titlePaddingHorizontal * groupLabelScale}px`,
                  fontSize: `${fontSize}px`,
                  fontFamily: 'EmOne, sans-serif',
                  fontWeight: 'bold',
                  lineHeight: `${labelLineHeight}px`,
                  color: isNodeGroup ? getTextColor(nodeGroupColor, theme.darkMode) : getTextColor(theme.canvas.bg, theme.darkMode),
                  backgroundColor: 'transparent',
                  border: 'none', outline: 'none',
                  padding: 0, resize: 'none', overflow: 'hidden',
                  overflowWrap: 'break-word', wordBreak: 'break-word',
                  textAlign: 'center', boxSizing: 'border-box'
                }}
              />
            </div>
          </foreignObject>
        ) : (
          <text x={labelX + labelWidth / 2} y={labelY + labelHeight / 2} fontFamily="EmOne, sans-serif" fontSize={fontSize}
            fill={isNodeGroup ? getTextColor(nodeGroupColor, theme.darkMode) : getTextColor(theme.canvas.bg, theme.darkMode)}
            fontWeight="bold" stroke="none" strokeWidth={0}
            paintOrder="stroke fill" textAnchor="middle" dominantBaseline="central"
            transform={groupLiftTransform}
          >
            {labelLines.length === 1 ? labelText : labelLines.map((line, i) => (
              <tspan
                key={i}
                x={labelX + labelWidth / 2}
                // Centre the whole block on the tab: first line sits
                // (n-1)/2 line boxes above the middle.
                dy={i === 0 ? -((labelLines.length - 1) / 2) * labelLineHeight : labelLineHeight}
              >
                {line}
              </tspan>
            ))}
          </text>
        )}
      </g>
    );

    if (isNodeGroup) {
      const innerCanvasFill = blendColors(theme.canvas.bg, nodeGroupColor, NODE_GROUP_INTERIOR_TINT);
      const innerCanvasRect = {
        x: rectX + GROUP_SPACING.innerCanvasBorder,
        y: innerCanvasY,
        w: rectW - (GROUP_SPACING.innerCanvasBorder * 2),
        h: (rectY + rectH) - innerCanvasY - GROUP_SPACING.innerCanvasBorder,
        r: GROUP_LAYOUT_CONSTANTS.innerCanvasCornerRadius,
      };
      // The whole shell — band and interior together — sits at this group's
      // nesting depth in the z-interleave, so it occludes exactly the
      // connections that don't have an endpoint inside it. See edgeZSlotFor.
      pushBackgroundAtDepth(groupDepth,
        <g key={`bg-${group.id}`} className="node-group-bg" data-group-id={group.id} style={groupStyle}>
          {/* Colored band is purely decorative — pointer-events:none lets
              connections routing under it stay clickable. Selection happens
              via the title label. The interior is canvas: handleCanvasClick
              treats a click on .node-group-interior like one on bare canvas. */}
          <rect x={rectX} y={nodeGroupRectY} width={rectW} height={nodeGroupRectH}
            rx={nodeGroupCornerR} ry={nodeGroupCornerR} fill={nodeGroupColor} stroke="none"
            pointerEvents="none" />
          <rect
            className="node-group-interior"
            x={innerCanvasRect.x} y={innerCanvasRect.y}
            width={innerCanvasRect.w}
            height={innerCanvasRect.h}
            rx={innerCanvasRect.r} ry={innerCanvasRect.r} fill={innerCanvasFill} stroke="none"
            style={{ cursor: 'default', pointerEvents: 'auto' }}
          />
          {/* The base grid is painted at the bottom of the z-stack, so this
              opaque interior would otherwise cut a blank hole in it. Repaint
              the same <pattern> on top: it's patternUnits="userSpaceOnUse" in
              world coordinates and this rect carries no transform of its own,
              so the tiling lines up continuously with the grid outside the
              group — and with every other group's, at any nesting depth.
              Always rendered (fill="none" when the grid is off) so the drag
              path's cached rect list keeps a stable shape. */}
          <rect
            className="node-group-grid"
            x={innerCanvasRect.x} y={innerCanvasRect.y}
            width={innerCanvasRect.w}
            height={innerCanvasRect.h}
            rx={innerCanvasRect.r} ry={innerCanvasRect.r}
            fill={gridActive ? `url(#${gridPatternId})` : 'none'}
            stroke="none"
            pointerEvents="none"
          />
        </g>
      );
      // Thing-group titles → Phase 3 (rendered after member nodes)
      ngTitles.push(
        <g key={`title-${group.id}`} className="node-group-title" data-group-id={group.id} style={groupStyle}>
          {titleLabel}
        </g>
      );
    } else {
      // Regular group: dashed outline + title, emitted together.
      // Where depends on nesting — a top-level one goes to the
      // bottom of the stack (under everything, as always), while a
      // nested one has to clear the shell of the node-group it sits
      // in or it renders behind opaque paint and vanishes.
      const regularElement = (
        <g key={group.id} className="group" data-group-id={group.id} style={groupStyle}>
          <rect x={rectX} y={rectY} width={rectW} height={rectH}
            rx={nodeGroupCornerR} ry={nodeGroupCornerR}
            fill="none" stroke={strokeColor} strokeWidth={12}
            strokeDasharray="16 12" />
          {titleLabel}
        </g>
      );
      if (groupDepth > 0) {
        pushAtDepth(nestedRegularByDepth, groupDepth, regularElement);
      } else {
        regularGroupElements.push(regularElement);
      }
    }
  });

  result.regular = regularGroupElements.length > 0 ? (
    <g className="regular-groups-layer">{regularGroupElements}</g>
  ) : null;
  return result;
}
