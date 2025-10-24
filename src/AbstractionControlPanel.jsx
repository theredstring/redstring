import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Trash2, Plus, ArrowUpFromDot, ArrowRight, Edit3 } from 'lucide-react';
import useGraphStore from './store/graphStore.jsx';
import UnifiedBottomControlPanel from './UnifiedBottomControlPanel';

const AbstractionControlPanel = ({ 
  selectedNode, 
  currentDimension = 'Generalization Axis', 
  availableDimensions = ['Generalization Axis'], 
  onDimensionChange,
  onAddDimension,
  onDeleteDimension,
  onExpandDimension,
  onOpenInPanel,
  typeListOpen = false, 
  isVisible = true, 
  onAnimationComplete,
  onActionHoverChange,
}) => {
  const nodePrototypesMap = useGraphStore((state) => state.nodePrototypes);
  const openRightPanelNodeTab = useGraphStore((state) => state.openRightPanelNodeTab);
  const createAndAssignGraphDefinitionWithoutActivation = useGraphStore((state) => state.createAndAssignGraphDefinitionWithoutActivation);

  // Store the last valid node data for use during exit animation
  const [lastValidNode, setLastValidNode] = useState(selectedNode);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingName, setEditingName] = useState(currentDimension);

  // Update lastValidNode when a new valid selectedNode is provided
  useEffect(() => {
    if (selectedNode) {
      setLastValidNode(selectedNode);
    }
  }, [selectedNode]);

  // Update editing name when current dimension changes
  useEffect(() => {
    setEditingName(currentDimension);
  }, [currentDimension]);

  // Only render when we have node data to work with
  if (!lastValidNode) return null;

  const currentDimensionIndex = availableDimensions.indexOf(currentDimension);
  const hasPreviousDimension = currentDimensionIndex > 0;
  const hasNextDimension = currentDimensionIndex < availableDimensions.length - 1;

  const handleDimensionNavigate = (direction) => {
    if (direction === 'left' && hasPreviousDimension) {
      const newDimension = availableDimensions[currentDimensionIndex - 1];
      onDimensionChange?.(newDimension);
    } else if (direction === 'right' && hasNextDimension) {
      const newDimension = availableDimensions[currentDimensionIndex + 1];
      onDimensionChange?.(newDimension);
    }
  };

  const handleAddDimension = () => {
    // Create a new dimension name
    const newDimensionName = `Generalization Axis ${availableDimensions.length + 1}`;
    onAddDimension?.(newDimensionName);
  };

  const handleDeleteDimension = () => {
    if (availableDimensions.length > 1) {
      onDeleteDimension?.(currentDimension);
    }
  };

  const handleExpandDimension = () => {
    if (!lastValidNode) return;
    
    // For now, just call the expand callback
    onExpandDimension?.(lastValidNode, currentDimension);
  };

  const handleOpenInPanel = () => {
    if (!lastValidNode) return;
    
    // Open the node in the right panel
    if (lastValidNode.prototypeId) {
      openRightPanelNodeTab(lastValidNode.prototypeId, lastValidNode.name);
    }
    
    // Also call the callback if provided
    onOpenInPanel?.(lastValidNode, currentDimension);
  };

  const handleEditName = () => {
    setIsEditingName(true);
  };

  const handleSaveName = () => {
    if (editingName.trim() && editingName !== currentDimension) {
      // Here you would typically update the dimension name in your store
      // For now, we'll just close the edit mode
      console.log('Would update dimension name to:', editingName);
    }
    setIsEditingName(false);
  };

  const handleCancelEdit = () => {
    setEditingName(currentDimension);
    setIsEditingName(false);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSaveName();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    } else if (e.key === 'Backspace' && editingName.trim() === '') {
      // Prevent backspace from deleting the node when the field is empty
      e.preventDefault();
    }
  };

  // Create the hierarchy display content
  const hierarchyContent = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div 
        className="piemenu-button" 
        onClick={() => handleDimensionNavigate('left')} 
        title="Previous" 
        style={{ 
          opacity: hasPreviousDimension ? 1 : 0.3,
          cursor: hasPreviousDimension ? 'pointer' : 'default'
        }}
        onMouseEnter={() => onActionHoverChange?.({ id: 'dimension-prev', label: 'Previous Dimension' })}
        onMouseLeave={() => onActionHoverChange?.(null)}
      >
        <ChevronLeft size={18} />
      </div>
      
      {isEditingName ? (
        <div
          contentEditable
          suppressContentEditableWarning
          onInput={(e) => setEditingName(e.currentTarget.textContent || '')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleSaveName(); }
            else { handleKeyPress(e); }
          }}
          onBlur={handleSaveName}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#DEDADA',
            border: 'none',
            borderRadius: '16px',
            padding: '8px 16px',
            color: '#000000',
            fontSize: '16px',
            fontWeight: 'bold',
            textAlign: 'center',
            minHeight: '40px',
            outline: 'none',
            whiteSpace: 'normal',
            wordBreak: 'break-word',
            lineHeight: '1.2'
          }}
        >{editingName}</div>
      ) : (
        <div 
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#DEDADA',
            borderRadius: '16px',
            padding: '8px 16px',
            border: 'none',
            minHeight: '40px',
            width: 'auto'
          }}
        >
          <span style={{ 
            color: '#000000',
            fontSize: '16px',
            fontWeight: 'bold',
            textAlign: 'center',
            lineHeight: '1.2',
            whiteSpace: 'normal',
            wordBreak: 'break-word'
          }}>
            {currentDimension}
          </span>
        </div>
      )}
      
      <div 
        className="piemenu-button" 
        onClick={() => handleDimensionNavigate('right')} 
        title="Next" 
        style={{ 
          opacity: hasNextDimension ? 1 : 0.3,
          cursor: hasNextDimension ? 'pointer' : 'default'
        }}
        onMouseEnter={() => onActionHoverChange?.({ id: 'dimension-next', label: 'Next Dimension' })}
        onMouseLeave={() => onActionHoverChange?.(null)}
      >
        <ChevronRight size={18} />
      </div>
    </div>
  );

  return (
    <UnifiedBottomControlPanel
      mode="abstraction"
      isVisible={isVisible}
      typeListOpen={typeListOpen}
      className="abstraction-control-panel"
      onAnimationComplete={onAnimationComplete}
      
      // Custom content for abstraction mode
      customContent={hierarchyContent}
      
      // Pie menu button handlers
      onAdd={handleAddDimension}
      onUp={handleExpandDimension}
      onOpenInPanel={handleOpenInPanel}
      onEdit={handleEditName}
      onDelete={handleDeleteDimension}
      
      // Only show delete if there are multiple dimensions
      showDelete={availableDimensions.length > 1}
      onActionHoverChange={onActionHoverChange}
    />
  );
};

export default AbstractionControlPanel; 
