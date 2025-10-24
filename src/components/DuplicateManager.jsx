import React, { useState, useEffect } from 'react';
import { Merge, AlertTriangle, Check, X, Plus, ArrowRight } from 'lucide-react';
import useGraphStore from '../store/graphStore.jsx';
import { NODE_DEFAULT_COLOR } from '../constants';

const DuplicateManager = ({ onClose }) => {
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [threshold, setThreshold] = useState(0.8);
  const [showDefinitionOptions, setShowDefinitionOptions] = useState(null); // { groupIndex, duplicateIndex, type: 'merge'|'reverse'|'create' }
  const [selectedNodes, setSelectedNodes] = useState(new Map()); // Map<groupIndex, nodeId>
  
  const { findPotentialDuplicates, mergeNodePrototypes, addNodePrototype, mergeDefinitionGraphs } = useGraphStore();

  useEffect(() => {
    const loadDuplicates = () => {
      setIsLoading(true);
      try {
        const groups = findPotentialDuplicates(threshold);
        setDuplicateGroups(groups);
      } catch (error) {
        console.error('Error finding duplicates:', error);
        setDuplicateGroups([]);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadDuplicates();
  }, [threshold, findPotentialDuplicates]);

  const selectNodeToKeep = (groupIndex, nodeId) => {
    setSelectedNodes(prev => {
      const newMap = new Map(prev);
      newMap.set(groupIndex, nodeId);
      return newMap;
    });
  };

  const handleMergeGroup = (group, groupIndex) => {
    const selectedNodeId = selectedNodes.get(groupIndex);
    
    if (!selectedNodeId) {
      // No node selected, do nothing
      return;
    }

    const allNodes = [group.primary, ...group.duplicates.map(d => d.node)];
    const selectedNode = allNodes.find(node => node.id === selectedNodeId);
    const nodesToMerge = allNodes.filter(node => node.id !== selectedNodeId);
    
    if (nodesToMerge.length === 0) {
      // Nothing to merge
      return;
    }
    
    // Check if any node has definition graphs
    const hasDefinitionGraphs = allNodes.some(node => 
      node.definitionGraphIds && node.definitionGraphIds.length > 0
    );
    
    if (hasDefinitionGraphs) {
      setShowDefinitionOptions({
        groupIndex,
        duplicateIndex: 0, // Not used for group merge
        type: 'merge',
        primaryId: selectedNodeId,
        secondaryId: null, // Will handle all nodes
        isGroupMerge: true,
        selectedNode,
        nodesToMerge
      });
      return;
    }
    
    // No definition graphs, proceed with merge
    nodesToMerge.forEach(nodeToMerge => {
      mergeNodePrototypes(selectedNodeId, nodeToMerge.id);
    });
    
    // Refresh the duplicate list
    const groups = findPotentialDuplicates(threshold);
    setDuplicateGroups(groups);
  };


  const handleIgnoreDuplicate = (groupIndex, duplicateIndex) => {
    // Remove this duplicate from the group
    setDuplicateGroups(prev => {
      const updated = [...prev];
      updated[groupIndex].duplicates.splice(duplicateIndex, 1);
      
      // Remove the entire group if no duplicates left
      if (updated[groupIndex].duplicates.length === 0) {
        updated.splice(groupIndex, 1);
      }
      
      return updated;
    });
  };

  const handleDefinitionMerge = (strategy, selections) => {
    const { isGroupMerge, groupIndex, primaryId, nodesToMerge } = showDefinitionOptions;
    
    try {
      if (isGroupMerge) {
        // Handle group merge - merge each node into the selected primary
        nodesToMerge.forEach(nodeToMerge => {
          // First merge definition graphs with chosen strategy
          mergeDefinitionGraphs(primaryId, nodeToMerge.id, { strategy });
          
          // Then merge the actual node prototypes
          mergeNodePrototypes(primaryId, nodeToMerge.id);
        });
      } else {
        const { secondaryId } = showDefinitionOptions;
        
        // First merge definition graphs with chosen strategy
        mergeDefinitionGraphs(primaryId, secondaryId, { strategy, ...selections });
        
        // Then merge the actual node prototypes
        mergeNodePrototypes(primaryId, secondaryId);
      }
      
      // Close the options modal
      setShowDefinitionOptions(null);
      
      // Refresh the duplicate list
      const groups = findPotentialDuplicates(threshold);
      setDuplicateGroups(groups);
    } catch (error) {
      console.error('Error merging with definition options:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="duplicate-manager-loading">
        <div className="loading-spinner"></div>
        <p>Analyzing nodes for duplicates...</p>
      </div>
    );
  }

  return (
    <div className="duplicate-manager">
      <div className="duplicate-manager-header">
        <div className="header-title">
          <Merge size={24} />
          <h2>Duplicate Node Manager</h2>
        </div>
        <button className="close-button" onClick={onClose}>
          <X size={20} />
        </button>
      </div>

      <div className="duplicate-manager-controls">
        <label className="threshold-control">
          Similarity Threshold: 
          <input 
            type="range" 
            min="0.5" 
            max="1.0" 
            step="0.05"
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
          />
          <span>{Math.round(threshold * 100)}%</span>
        </label>
      </div>

      {duplicateGroups.length === 0 ? (
        <div className="no-duplicates">
          <Check size={48} color="#22c55e" />
          <h3>No Duplicates Found</h3>
          <p>No similar nodes detected with the current threshold.</p>
        </div>
      ) : (
        <div className="duplicate-groups">
          <div className="summary">
            <AlertTriangle size={20} color="#f59e0b" />
            <span>Found {duplicateGroups.length} groups with potential duplicates</span>
          </div>
          
          {duplicateGroups.map((group, groupIndex) => (
            <div key={groupIndex} className="duplicate-group">
              <div className="group-header">
                <h3>Group {groupIndex + 1}: "{group.primary.name}"</h3>
                <span className="node-count">{group.totalNodes} nodes</span>
              </div>
              
              <div className="primary-node">
                <div className="node-preview">
                  <input
                    type="radio"
                    name={`group-${groupIndex}`}
                    className="node-radio"
                    style={{ backgroundColor: group.primary.color || NODE_DEFAULT_COLOR }}
                    checked={selectedNodes.get(groupIndex) === group.primary.id}
                    onChange={() => selectNodeToKeep(groupIndex, group.primary.id)}
                  />
                  <div className="node-info">
                    <div className="node-name">{group.primary.name}</div>
                    <div className="node-meta">
                      Primary • {group.primary.semanticMetadata ? 'Has semantic data' : 'No semantic data'}
                    </div>
                    {group.primary.description && (
                      <div className="node-description">
                        {group.primary.description.slice(0, 100)}...
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="duplicate-nodes">
                {group.duplicates.map((duplicate, duplicateIndex) => (
                  <div key={duplicateIndex} className="duplicate-node">
                    <div className="node-preview">
                      <input
                        type="radio"
                        name={`group-${groupIndex}`}
                        className="node-radio"
                        style={{ backgroundColor: duplicate.node.color || NODE_DEFAULT_COLOR }}
                        checked={selectedNodes.get(groupIndex) === duplicate.node.id}
                        onChange={() => selectNodeToKeep(groupIndex, duplicate.node.id)}
                      />
                      <div className="node-info">
                        <div className="node-name">{duplicate.node.name}</div>
                        <div className="node-meta">
                          {Math.round(duplicate.similarity * 100)}% similarity • 
                          {duplicate.node.semanticMetadata ? ' Has semantic data' : ' No semantic data'}
                        </div>
                        {duplicate.node.description && (
                          <div className="node-description">
                            {duplicate.node.description.slice(0, 100)}...
                          </div>
                        )}
                        <div className="similarity-reasons">
                          {duplicate.reasons.map((reason, i) => (
                            <span key={i} className="reason">{reason}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    
                  </div>
                ))}
              </div>
              
              {/* Full-width merge button */}
              <button 
                className="merge-group-button"
                onClick={() => handleMergeGroup(group, groupIndex)}
                title="Keep selected node and merge others into it"
                disabled={!selectedNodes.get(groupIndex)}
              >
                <Merge size={16} />
                <span>
                  {(() => {
                    const selectedNodeId = selectedNodes.get(groupIndex);
                    if (!selectedNodeId) return 'Select which node to keep';
                    
                    const allNodes = [group.primary, ...group.duplicates.map(d => d.node)];
                    const selectedNode = allNodes.find(node => node.id === selectedNodeId);
                    const otherCount = allNodes.length - 1;
                    
                    return `Keep "${selectedNode?.name || 'Unknown'}" & Merge ${otherCount} Others`;
                  })()}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}

      {showDefinitionOptions && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}>
          <DefinitionGraphMergeOptions
            options={showDefinitionOptions}
            duplicateGroups={duplicateGroups}
            onConfirm={(strategy, selections) => handleDefinitionMerge(strategy, selections)}
            onCancel={() => setShowDefinitionOptions(null)}
          />
        </div>
      )}

      <style jsx>{`
        .duplicate-manager {
          background: #1a1a1a;
          color: #e5e5e5;
          border-radius: 12px;
          padding: 24px;
          max-height: 80vh;
          overflow-y: auto;
          width: 700px;
          font-family: 'EmOne', sans-serif;
        }

        .duplicate-manager-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          padding-bottom: 16px;
          border-bottom: 1px solid #333;
        }

        .header-title {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .header-title h2 {
          margin: 0;
          font-size: 1.5rem;
          color: #f8f8f8;
        }

        .close-button {
          background: none;
          border: none;
          color: #888;
          cursor: pointer;
          padding: 8px;
          border-radius: 6px;
        }

        .close-button:hover {
          background: #333;
          color: #e5e5e5;
        }

        .duplicate-manager-controls {
          margin-bottom: 24px;
          padding: 16px;
          background: #222;
          border-radius: 8px;
        }

        .threshold-control {
          display: flex;
          align-items: center;
          gap: 12px;
          color: #ccc;
        }

        .threshold-control input[type="range"] {
          flex: 1;
          accent-color: #4F46E5;
        }

        .threshold-control span {
          font-weight: bold;
          color: #4F46E5;
          min-width: 40px;
        }

        .no-duplicates {
          text-align: center;
          padding: 40px 20px;
        }

        .no-duplicates h3 {
          color: #22c55e;
          margin: 16px 0 8px;
        }

        .summary {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 20px;
          padding: 12px;
          background: #2a1a0f;
          border-radius: 6px;
          color: #fbbf24;
        }

        .duplicate-group {
          background: #222;
          border-radius: 8px;
          margin-bottom: 16px;
          padding: 16px;
        }

        .group-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }

        .group-header h3 {
          margin: 0;
          color: #f8f8f8;
        }

        .merge-group-button {
          width: 100%;
          margin-top: 16px;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 12px 16px;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.9rem;
          font-weight: bold;
          background: #4F46E5;
          color: white;
          transition: all 0.2s;
          font-family: 'EmOne', sans-serif;
        }

        .merge-group-button:hover:not(:disabled) {
          background: #4338CA;
        }

        .merge-group-button:disabled {
          background: #666;
          cursor: not-allowed;
          opacity: 0.7;
        }

        .node-count {
          background: #4F46E5;
          color: white;
          padding: 4px 8px;
          border-radius: 12px;
          font-size: 0.8rem;
          font-weight: bold;
        }

        .primary-node {
          margin-bottom: 12px;
          padding: 12px;
          background: #2a2a2a;
          border-radius: 6px;
          border-left: 4px solid #22c55e;
        }

        .duplicate-node {
          padding: 12px;
          background: #2a2a2a;
          border-radius: 6px;
          margin-bottom: 8px;
          border-left: 4px solid #f59e0b;
        }

        .node-preview {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          flex: 1;
        }

        .node-radio {
          width: 20px;
          height: 20px;
          margin-top: 2px;
          cursor: pointer;
          border: 2px solid #333;
          border-radius: 50%;
          position: relative;
          appearance: none;
          -webkit-appearance: none;
          transform: scale(1.1);
        }

        .node-radio:checked {
          border-color: #fff;
        }

        .node-radio:checked::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 8px;
          height: 8px;
          background: white;
          border-radius: 50%;
        }

        .node-info {
          flex: 1;
        }

        .node-name {
          font-weight: bold;
          color: #f8f8f8;
          margin-bottom: 4px;
        }

        .node-meta {
          font-size: 0.8rem;
          color: #888;
          margin-bottom: 4px;
        }

        .node-description {
          font-size: 0.85rem;
          color: #ccc;
          line-height: 1.3;
          margin-bottom: 8px;
        }

        .similarity-reasons {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .reason {
          background: #333;
          color: #ccc;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.7rem;
        }


        .loading-spinner {
          width: 40px;
          height: 40px;
          border: 4px solid #333;
          border-top: 4px solid #4F46E5;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 16px;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .duplicate-manager-loading {
          text-align: center;
          padding: 40px;
          color: #ccc;
        }
      `}</style>
    </div>
  );
};

// Definition Graph Merge Confirmation Component
const DefinitionGraphMergeOptions = ({ options, duplicateGroups, onConfirm, onCancel }) => {
  const group = duplicateGroups[options.groupIndex];
  const allNodes = [group.primary, ...group.duplicates.map(d => d.node)];
  const selectedNode = allNodes.find(node => node.id === options.primaryId);
  const nodesToMerge = allNodes.filter(node => node.id !== options.primaryId);

  const getNodeDisplayText = (nodes) => {
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return 'no nodes';
    }
    
    // Ensure we have valid node objects
    const validNodes = nodes.filter(n => n && n.name);
    
    if (validNodes.length === 0) {
      return 'unnamed nodes';
    }
    
    if (validNodes.length === 1) {
      return `"${validNodes[0].name}"`;
    } else if (validNodes.length === 2) {
      return `"${validNodes[0].name}" and "${validNodes[1].name}"`;
    } else if (validNodes.length === 3) {
      return `"${validNodes[0].name}", "${validNodes[1].name}", and "${validNodes[2].name}"`;
    } else {
      return `"${validNodes[0].name}", "${validNodes[1].name}", and ${validNodes.length - 2} others`;
    }
  };

  const handleConfirm = () => {
    // Always combine definition graphs since we're keeping one node
    onConfirm('combine', {});
  };

  return (
    <div style={{
      background: '#1a1a1a',
      color: '#e5e5e5',
      borderRadius: '12px',
      padding: '24px',
      maxWidth: '500px',
      fontFamily: "'EmOne', sans-serif"
    }}>
      <h3 style={{ margin: '0 0 20px', color: '#f8f8f8' }}>
        Confirm Merge
      </h3>
      
      <div style={{ marginBottom: '24px' }}>
        <div style={{ padding: '16px', background: '#2a2a2a', borderRadius: '8px', marginBottom: '16px' }}>
          <h4 style={{ margin: '0 0 12px', color: '#f8f8f8', fontSize: '1rem' }}>
            Merge {getNodeDisplayText(nodesToMerge)} into "{selectedNode?.name || 'Selected Node'}"
          </h4>
          
          <div style={{ color: '#ccc', fontSize: '0.9rem', lineHeight: 1.4 }}>
            <p style={{ margin: '0 0 8px' }}>
              This will:
            </p>
            <ul style={{ margin: '0 0 0 20px', padding: 0 }}>
              <li>Keep <strong style={{ color: '#22c55e' }}>"{selectedNode?.name || 'Selected Node'}"</strong> as the primary node</li>
              <li>Merge all data (descriptions, metadata, relationships) from the other nodes</li>
              <li>Update all graph references to point to "{selectedNode?.name || 'Selected Node'}"</li>
              <li>Combine all definition graphs from all nodes</li>
              <li>Delete the merged nodes: {getNodeDisplayText(nodesToMerge)}</li>
            </ul>
          </div>
        </div>
        
        <div style={{ padding: '12px', background: 'rgba(245, 158, 11, 0.1)', borderRadius: '6px', borderLeft: '3px solid #f59e0b' }}>
          <span style={{ color: '#fbbf24', fontSize: '0.85rem' }}>
            ⚠️ This action cannot be undone. All references throughout your graphs will be updated.
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{
            padding: '8px 16px',
            border: 'none',
            borderRadius: '6px',
            background: '#666',
            color: 'white',
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          style={{
            padding: '8px 16px',
            border: 'none',
            borderRadius: '6px',
            background: '#22c55e',
            color: 'white',
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          Merge
        </button>
      </div>
    </div>
  );
};

export default DuplicateManager;