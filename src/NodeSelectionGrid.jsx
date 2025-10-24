import React, { useMemo, useEffect, useState, useRef, useCallback } from 'react';
import NodeGridItem from './NodeGridItem';
import useGraphStore from './store/graphStore.jsx';
import './NodeSelectionGrid.css';

const NodeSelectionGrid = ({ 
  isVisible, 
  onNodeSelect, 
  onClose,
  position = { x: 0, y: 0 },
  width = 280,
  bottomOffset = 20,
  onCreateNew,
  showCreateNewOption = false,
  searchTerm = ''
}) => {
  // Get all node prototypes from the store
  const nodePrototypesMap = useGraphStore(state => state.nodePrototypes);
  
  // Convert to array and sort by name
  const availablePrototypes = useMemo(() => {
    const prototypes = Array.from(nodePrototypesMap.values());
    // Filter out prototypes without names first, then sort
    const validPrototypes = prototypes.filter(p => p.name);
    const sorted = validPrototypes.sort((a, b) => a.name.localeCompare(b.name));

    if (!searchTerm?.trim()) {
        return sorted;
    }
    // Perform case-insensitive search
    return sorted.filter(p => 
        p.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [nodePrototypesMap, searchTerm]);

  const scrollContainerRef = useRef(null);

  const handleNodeClick = (nodePrototype) => {
    onNodeSelect(nodePrototype);
  };

  // Handle wheel events to prevent NodeCanvas panning
  const handleWheel = useCallback((e) => {
    e.stopPropagation(); // Stop NodeCanvas from receiving the event
    // Let the browser handle the actual scrolling
  }, []);


  // Handle click away
  const handleClickAway = useCallback((e) => {
    if (scrollContainerRef.current && !scrollContainerRef.current.contains(e.target)) {
      onClose();
    }
  }, [onClose]);

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isVisible) {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isVisible, onClose]);

  // Prevent body scrolling when visible
  useEffect(() => {
    if (isVisible) {
      // Store original overflow
      const originalOverflow = document.body.style.overflow;
      
      // Prevent scrolling
      document.body.style.overflow = 'hidden';
      
      // Add click away listener
      document.addEventListener('mousedown', handleClickAway);
      
      return () => {
        // Restore scrolling
        document.body.style.overflow = originalOverflow;
        document.removeEventListener('mousedown', handleClickAway);
      };
    }
  }, [isVisible, handleClickAway]);

  // Add wheel event listener to prevent NodeCanvas panning
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container && isVisible) {
      container.addEventListener('wheel', handleWheel, { passive: false });
      return () => {
        container.removeEventListener('wheel', handleWheel, { passive: false });
      };
    }
  }, [isVisible, handleWheel]);



  if (!isVisible) {
    return null;
  }

  return (
    <>
      {/* Grid container - positioned above overlay */}
      <div
        ref={scrollContainerRef}
        className="node-selection-grid-container"
        style={{
          position: 'fixed',
          left: position.x,
          top: position.y,
          bottom: `${bottomOffset}px`,
          width: `${width}px`,
          zIndex: 1002, // Above dialog (1001) and overlay (1000)
          overflowY: 'auto', // Use native scrolling
          pointerEvents: 'auto',
          padding: '12px'
        }}
      >
        {/* Grid content */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '12px',
            alignContent: 'start'
          }}
        >
          {/* Create New Option */}
          {showCreateNewOption && (
            <div
              onClick={() => onCreateNew && onCreateNew()}
              style={{
                gridColumn: '1 / -1', // Span full width
                height: '50px',
                backgroundColor: '#716C6C',
                border: '2px solid #260000',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                marginBottom: '8px',
                fontWeight: 'bold',
                color: '#bdb5b5',
                fontSize: '16px',
                fontFamily: "'EmOne', sans-serif"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#5c5858';
                e.currentTarget.style.borderColor = '#000000';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#716C6C';
                e.currentTarget.style.borderColor = '#260000';
              }}
            >
              + Create New Type
            </div>
          )}
          
          {availablePrototypes.length === 0 ? null : (
            availablePrototypes.map((prototype) => (
              <NodeGridItem
                key={prototype.id}
                nodePrototype={prototype}
                onClick={handleNodeClick}
                width={132} // Calculated to fit 300px container: (300-24-12)/2 = 132
                height={80}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
};

export default NodeSelectionGrid; 