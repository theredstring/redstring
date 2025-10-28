import React from 'react';
import UniversalNodeRenderer from '../UniversalNodeRenderer';

const HoverVisionAid = ({
  hoveredNode,
  hoveredConnection,
  activePieMenuItem,
  headerHeight = 60,
  verticalOffset = -18
}) => {
  const hasConnection = Boolean(hoveredConnection?.source && hoveredConnection?.target);
  const hasNode = Boolean(!hasConnection && hoveredNode);
  const hasItem = Boolean(!hasConnection && !hasNode && activePieMenuItem);

  if (!hasConnection && !hasNode && !hasItem) {
    return null;
  }

  const NODE_PREVIEW_HEIGHT = 82;
  const CONNECTION_PREVIEW_HEIGHT = 120;

  const connectionSource = hoveredConnection?.source;
  const connectionTarget = hoveredConnection?.target;
  const connectionNameLength = hoveredConnection?.name ? hoveredConnection.name.length : 0;
  const connectionTextWidth = connectionNameLength * 12;
  const connectionContainerWidth = Math.max(360, connectionTextWidth + 300);
  const connectionSpacing = Math.max(200, connectionTextWidth + 150);

  const baseNodeWidth = hoveredNode?.width ?? 176;
  const nodeContainerWidth = Math.max(228, baseNodeWidth + 110);

  const pieMenuHeight = 36;
  const pieMenuPaddingX = 14;

  let content = null;

  const containerStyle = {
    position: 'absolute',
    top: headerHeight + verticalOffset,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
    pointerEvents: 'none',
    zIndex: 4
  };

  if (hasConnection) {
    containerStyle.marginTop = -8;
    content = (
      <div
        style={{
          display: 'inline-flex',
          padding: 0,
          borderRadius: '44px',
          background: 'transparent',
          overflow: 'visible'
        }}
      >
        <UniversalNodeRenderer
          nodes={[
            {
              id: connectionSource.id,
              name: connectionSource.name,
              color: connectionSource.color,
              prototypeId: connectionSource.prototypeId,
              width: 190,
              height: CONNECTION_PREVIEW_HEIGHT
            },
            {
              id: connectionTarget.id,
              name: connectionTarget.name,
              color: connectionTarget.color,
              prototypeId: connectionTarget.prototypeId,
              width: 190,
              height: CONNECTION_PREVIEW_HEIGHT
            }
          ]}
          connections={[
            {
              id: hoveredConnection.id,
              sourceId: hoveredConnection.source.id,
              destinationId: hoveredConnection.target.id,
              connectionName: hoveredConnection.name,
              color: hoveredConnection.color,
              definitionNodeIds: hoveredConnection.definitionNodeIds,
              typeNodeId: hoveredConnection.typeNodeId,
              directionality: hoveredConnection.directionality
            }
          ]}
          containerWidth={connectionContainerWidth}
          containerHeight={CONNECTION_PREVIEW_HEIGHT}
          padding={12}
          scaleMode="fixed"
          minNodeSize={200}
          maxNodeSize={280}
          cornerRadiusMultiplier={44}
          connectionFontScale={1.35}
          nodeFontScale={1.0}
          interactive={false}
          showHoverEffects={false}
          showConnectionDots={true}
          alignNodesHorizontally={true}
          minHorizontalSpacing={connectionSpacing}
        />
      </div>
    );
  } else if (hasNode) {
    containerStyle.marginTop = -6;
    content = (
      <div
        style={{
          display: 'inline-flex',
          padding: 0,
          borderRadius: '36px',
          background: 'transparent',
          overflow: 'visible'
        }}
      >
        <UniversalNodeRenderer
          nodes={[
            {
              id: hoveredNode.id,
              name: hoveredNode.name,
              color: hoveredNode.color,
              prototypeId: hoveredNode.prototypeId,
              width: baseNodeWidth,
              height: NODE_PREVIEW_HEIGHT
            }
          ]}
          connections={[]}
          containerWidth={nodeContainerWidth}
          containerHeight={NODE_PREVIEW_HEIGHT}
          padding={8}
          scaleMode="fixed"
          minNodeSize={160}
          maxNodeSize={240}
          cornerRadiusMultiplier={32}
          nodeFontScale={1.0}
          interactive={false}
          showHoverEffects={false}
        />
      </div>
    );
  } else if (hasItem) {
    containerStyle.marginTop = -2;
    content = (
      <div
        style={{
          minWidth: 140,
          height: pieMenuHeight,
          borderRadius: pieMenuHeight / 2,
          border: '2px solid maroon',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: "'EmOne', sans-serif",
          fontSize: '14px',
          fontWeight: 700,
          color: 'maroon',
          background: '#DEDADA',
          letterSpacing: '0.04em',
          padding: `0 ${pieMenuPaddingX}px`,
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)'
        }}
      >
        {activePieMenuItem.label}
      </div>
    );
  }

  return (
    <div className="hover-vision-aid" style={containerStyle}>
      {content}
    </div>
  );
};

export default HoverVisionAid;
