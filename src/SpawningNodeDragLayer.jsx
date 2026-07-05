import React from 'react';
import { useDragLayer }from 'react-dnd';
import useGraphStore from './store/graphStore.js';
import Node from './Node.jsx';
import { getNodeDimensions } from './utils.js';

const SPAWNABLE_NODE = 'spawnable_node';

const layerStyles = {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: 15000,
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
};

function getItemStyles(currentOffset) {
    if (!currentOffset) {
        return { display: 'none' };
    }
    const { x, y } = currentOffset;
    const transform = `translate(${x}px, ${y}px)`;
    return {
        transform,
        WebkitTransform: transform,
    };
}

const SpawningNodeDragLayer = () => {
    const { itemType, isDragging, item, currentOffset } = useDragLayer((monitor) => ({
        item: monitor.getItem(),
        itemType: monitor.getItemType(),
        isDragging: monitor.isDragging(),
        currentOffset: monitor.getClientOffset(),
    }));

    const node = useGraphStore(state => (item?.prototypeId ? state.nodePrototypes.get(item.prototypeId) : null));

    // Handle semantic concepts that need materialization
    let displayNode = node;
    if (!node && item?.needsMaterialization && item?.conceptData) {
        // Create a temporary node representation for the semantic concept
        displayNode = {
            id: item.conceptData.id,
            name: item.conceptData.name,
            description: item.conceptData.description,
            color: item.conceptData.color,
            typeNodeId: 'base-thing-prototype',
            definitionGraphIds: [],
            imageSrc: null
        };
    }

    if (!isDragging || itemType !== SPAWNABLE_NODE || !currentOffset || !displayNode) {
        return null;
    }

    const dimensions = getNodeDimensions(displayNode, false, null);
    const W = dimensions.currentWidth;
    const H = dimensions.currentHeight;

    // Screen-space preview scale. The ghost is rendered at fixed px (not canvas-zoom
    // aware) and getNodeDimensions already folds in a 1.4x geometry factor, so the
    // full node draws at ~252px. The `scale` prop on the node is a no-op here — the
    // Node's isDragging branch deliberately omits the React transform — so we must
    // scale the SVG content with a real <g transform>. 0.4 keeps the ghost around the
    // ~100px it was before NODE_WIDTH doubled.
    const scale = 0.4;

    const clonedNode = {
        ...displayNode,
        x: 0,
        y: 0,
    };

    return (
        <div style={layerStyles}>
            <div style={getItemStyles(currentOffset)}>
                <svg
                    width={W * scale}
                    height={H * scale}
                    style={{ overflow: 'visible' }}
                >
                    {/* Scale the full-size node down and center it on the cursor. */}
                    <g transform={`translate(${-W * scale / 2}, ${-H * scale / 2}) scale(${scale})`}>
                        <Node
                            node={clonedNode}
                            isSelected={false}
                            isDragging={true}
                            onMouseDown={() => {}}
                            currentWidth={W}
                            currentHeight={H}
                            textAreaHeight={dimensions.textAreaHeight}
                            imageWidth={dimensions.imageWidth}
                            imageHeight={dimensions.calculatedImageHeight}
                            scaledPadding={dimensions.scaledPadding}
                            scaledCornerRadius={dimensions.scaledCornerRadius}
                            descriptionAreaHeight={dimensions.descriptionAreaHeight}
                            isPreviewing={false}
                        />
                    </g>
                </svg>
            </div>
        </div>
    );
};

export default SpawningNodeDragLayer; 