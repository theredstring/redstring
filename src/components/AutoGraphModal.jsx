/**
 * Auto Graph Modal
 * 
 * Modal UI for generating graphs from various data formats
 */

import React, { useState } from 'react';
import { X, Play, FileText, Zap } from 'lucide-react';
import { getSampleData } from '../services/autoGraphGenerator.js';
import './AutoGraphModal.css';

const AutoGraphModal = ({ isOpen, onClose, onGenerate, activeGraphId }) => {
  const [inputFormat, setInputFormat] = useState('simple');
  const [layoutAlgorithm, setLayoutAlgorithm] = useState('force');
  const [customData, setCustomData] = useState('');
  const [selectedSample, setSelectedSample] = useState('simple');
  const [inputMode, setInputMode] = useState('sample'); // 'sample' or 'custom'
  const [targetMode, setTargetMode] = useState('current'); // 'current' or 'new'
  
  if (!isOpen) return null;

  const samples = {
    simple: getSampleData('simple'),
    family: getSampleData('family'),
    knowledge: getSampleData('knowledge'),
    concepts: getSampleData('concepts')
  };

  const handleGenerate = () => {
    let inputData;
    
    if (inputMode === 'sample') {
      inputData = samples[selectedSample].data;
    } else {
      inputData = customData;
    }
    
    const options = {
      layoutAlgorithm,
      createNewGraph: targetMode === 'new',
      replaceExisting: false,
      graphName: 'New Thing',
      layoutOptions: {
        width: 2000,
        height: 1500,
        padding: 200,
        preSimulate: true, // Run simulation to equilibrium before placing
        iterations: 200   // Fast pre-simulation iterations
      }
    };
    
    onGenerate(inputData, inputFormat, options);
  };

  const getSamplePreview = () => {
    const sample = samples[selectedSample];
    return `${sample.description}\n\nNodes: ${sample.data.nodes?.length || 'N/A'}\nEdges: ${sample.data.edges?.length || 'N/A'}`;
  };

  return (
    <div className="autograph-modal-overlay" onClick={onClose}>
      <div className="autograph-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="autograph-modal-header">
          <div className="autograph-modal-title">
            <Zap size={20} />
            <span>Generate Test Graph</span>
          </div>
          <button className="autograph-modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="autograph-modal-content">
          
          {/* Input Mode Selection */}
          <div className="autograph-section">
            <label className="autograph-label">Data Source</label>
            <div className="autograph-button-group">
              <button
                className={`autograph-button ${inputMode === 'sample' ? 'active' : ''}`}
                onClick={() => setInputMode('sample')}
              >
                <FileText size={16} />
                Sample Data
              </button>
              <button
                className={`autograph-button ${inputMode === 'custom' ? 'active' : ''}`}
                onClick={() => setInputMode('custom')}
              >
                <FileText size={16} />
                Custom Data
              </button>
            </div>
          </div>

          {/* Sample Selection */}
          {inputMode === 'sample' && (
            <div className="autograph-section">
              <label className="autograph-label">Sample Template</label>
              <select
                className="autograph-select"
                value={selectedSample}
                onChange={(e) => setSelectedSample(e.target.value)}
              >
                <option value="simple">Simple Network (5 nodes)</option>
                <option value="family">Family Tree (6 nodes, hierarchical)</option>
                <option value="knowledge">Knowledge Graph (4 nodes, JSON-LD)</option>
                <option value="concepts">Concept Network (7 nodes, dense)</option>
              </select>
              <div className="autograph-preview">
                {getSamplePreview()}
              </div>
            </div>
          )}

          {/* Custom Data Input */}
          {inputMode === 'custom' && (
            <div className="autograph-section">
              <label className="autograph-label">Input Format</label>
              <select
                className="autograph-select"
                value={inputFormat}
                onChange={(e) => setInputFormat(e.target.value)}
              >
                <option value="auto">Auto-detect</option>
                <option value="simple">Simple JSON (nodes + edges)</option>
                <option value="jsonld">JSON-LD / RDF</option>
              </select>
              
              <label className="autograph-label" style={{ marginTop: '12px' }}>Data (JSON)</label>
              <textarea
                className="autograph-textarea"
                value={customData}
                onChange={(e) => setCustomData(e.target.value)}
                placeholder={`Example Simple JSON:\n{\n  "nodes": [\n    { "name": "Node A", "color": "#8B0000" },\n    { "name": "Node B" }\n  ],\n  "edges": [\n    { "source": "Node A", "target": "Node B", "relation": "connects to" }\n  ]\n}`}
                rows={10}
              />
            </div>
          )}

          {/* Layout Algorithm */}
          <div className="autograph-section">
            <label className="autograph-label">Layout Algorithm</label>
            <select
              className="autograph-select"
              value={layoutAlgorithm}
              onChange={(e) => setLayoutAlgorithm(e.target.value)}
            >
              <option value="force">Force-Directed (physics-based, general purpose)</option>
              <option value="hierarchical">Hierarchical (tree-like structures)</option>
              <option value="radial">Radial (orbits around center)</option>
              <option value="grid">Grid (organized rows/columns)</option>
              <option value="circular">Circular (nodes on circle perimeter)</option>
            </select>
          </div>

          {/* Target Mode */}
          <div className="autograph-section">
            <label className="autograph-label">Target</label>
            <div className="autograph-radio-group">
              <label className="autograph-radio">
                <input
                  type="radio"
                  name="target"
                  value="current"
                  checked={targetMode === 'current'}
                  onChange={(e) => setTargetMode(e.target.value)}
                  disabled={!activeGraphId}
                />
                <span>Add to Current Graph</span>
                {!activeGraphId && <span className="autograph-hint"> (No active graph)</span>}
              </label>
              <label className="autograph-radio">
                <input
                  type="radio"
                  name="target"
                  value="new"
                  checked={targetMode === 'new'}
                  onChange={(e) => setTargetMode(e.target.value)}
                />
                <span>Create New Graph (New Thing)</span>
              </label>
            </div>
          </div>
          
          {/* Info */}
          <div className="autograph-section">
            <div className="autograph-info-box">
              ℹ️ Layout will be pre-simulated to equilibrium before placing nodes for instant good layout!
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="autograph-modal-footer">
          <button className="autograph-button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="autograph-button-primary"
            onClick={handleGenerate}
            disabled={!activeGraphId || (inputMode === 'custom' && !customData.trim())}
          >
            <Play size={16} />
            Add to Current Graph
          </button>
        </div>
      </div>
    </div>
  );
};

export default AutoGraphModal;

