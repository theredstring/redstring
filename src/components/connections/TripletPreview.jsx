import React from 'react';
import UniversalNodeRenderer from '../../UniversalNodeRenderer';
import { RENDERER_PRESETS } from '../../UniversalNodeRenderer.presets';
import { connectionPreviewRendererProps, previewTextFor } from '../../utils/connectionPreview.js';
import { PANEL_RENDERER_PADDING, layoutPanelConnection } from '../../utils/connectionRowLayout.js';
import useMobileDetection from '../../hooks/useMobileDetection';

const DEFAULT_COLOR = '#8B0000';
const ARROW_TO_OBJECT = new Set(['object']);

/**
 * One statement drawn the way the canvas draws it: subject node, the
 * connection with its label, object node. Every panel list of connections —
 * a Thing's own, or what the semantic web says about it — uses this, so a
 * connection looks the same before it's added as after.
 *
 * @param {Object} props
 * @param {string} props.subject
 * @param {string} props.predicate
 * @param {string} props.object
 * @param {string} [props.subjectColor]
 * @param {string} [props.objectColor]
 * @param {string} [props.connectionColor]
 * @param {Set<'subject'|'object'>} [props.arrowsToward] - which ends carry an arrowhead
 * @param {number} props.containerWidth
 */
const TripletPreview = ({
  subject,
  predicate,
  object,
  subjectColor,
  objectColor,
  connectionColor,
  arrowsToward = ARROW_TO_OBJECT,
  containerWidth = 400
}) => {
  const { isMobile } = useMobileDetection();
  const str = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

  // Divide the row between the two node boxes and the connection between them at
  // the platform's fixed text size — node names and the predicate come back
  // already truncated to their budgets, and the scale pins the renderer there.
  const { nodes, span, width, height, scale, labelFontScale, predicate: displayPredicate } =
    layoutPanelConnection({
      nodes: [
        { id: 'subject', name: str(subject), color: subjectColor || DEFAULT_COLOR },
        { id: 'object', name: str(object), color: objectColor || DEFAULT_COLOR }
      ],
      predicate: str(predicate),
      containerWidth,
      hasArrows: arrowsToward.size > 0,
      text: previewTextFor(isMobile)
    });

  const connections = [{
    id: 'conn',
    sourceId: 'subject',
    destinationId: 'object',
    connectionName: displayPredicate,
    color: connectionColor || subjectColor || DEFAULT_COLOR,
    directionality: { arrowsToward }
  }];

  return (
    <UniversalNodeRenderer
      {...RENDERER_PRESETS.CONNECTION_BROWSER}
      {...connectionPreviewRendererProps()}
      nodes={nodes}
      connections={connections}
      padding={PANEL_RENDERER_PADDING}
      // The row's own width, not the column's: each statement sits at the
      // start of its row as one unit, so a list of them reads down one edge.
      containerWidth={Math.min(width || containerWidth, containerWidth)}
      containerHeight={height}
      maxNodeScale={scale}
      horizontalSpacing={span}
      connectionFontScale={labelFontScale}
    />
  );
};

// Rows re-render with their list; a row whose statement hasn't changed doesn't
// need its SVG rebuilt.
export default React.memo(TripletPreview);
