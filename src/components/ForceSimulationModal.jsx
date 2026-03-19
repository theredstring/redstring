import React, { useState, useRef, useEffect } from 'react';
import { X, Play, Pause, RotateCcw, Shuffle, Copy, ChevronDown, ChevronUp, Info } from 'lucide-react';
import './ForceSimulationModal.css';
import { useForceSimulation } from '../hooks/useForceSimulation.js';
import { useTheme } from '../hooks/useTheme.js';
import { MAX_LAYOUT_SCALE_MULTIPLIER } from '../services/graphLayoutService.js';
import MaroonSlider from './MaroonSlider.jsx';

/**
 * Draggable modal for interactive force-directed layout tuning.
 * All simulation logic lives in useForceSimulation — this is UI only.
 */
const ForceSimulationModal = ({
  isOpen,
  onClose,
  graphId,
  storeActions,
  getNodes,
  getEdges,
  getGroups = () => [],
  getDraggedNodeIds = () => new Set(),
  onNodePositionsUpdated,
  layoutScalePreset,
  layoutScaleMultiplier,
  onLayoutScalePresetChange,
  onLayoutScaleMultiplierChange,
  layoutIterationPreset,
  onLayoutIterationPresetChange,
  onCopyToAutoLayout,
  autoStart = false,
  invisible = false,
  onSimulationComplete = null,
  autoLayoutDuration = 1000
}) => {
  const theme = useTheme();

  // --- Simulation engine (all physics + params) ---
  const sim = useForceSimulation({
    graphId,
    enabled: isOpen,
    getNodes,
    getEdges,
    getGroups,
    getDraggedNodeIds,
    onPositionsUpdated: onNodePositionsUpdated,
    onSimulationComplete,
    storeActions,
    autoStart,
    autoLayoutDuration,
    layoutScaleMultiplier,
    layoutIterationPreset,
    onLayoutScaleMultiplierChange,
    onLayoutIterationPresetChange,
    onLayoutScalePresetChange,
  });

  // --- UI-only state ---
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showJson, setShowJson] = useState(false);
  const modalRef = useRef(null);

  // --- Modal dragging ---
  const handleMouseDown = (e) => {
    if (e.target.closest('.force-sim-header')) {
      setIsDragging(true);
      setDragOffset({
        x: e.clientX - position.x,
        y: e.clientY - position.y
      });
    }
  };

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e) => {
      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      });
    };
    const handleMouseUp = () => setIsDragging(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  // --- Clipboard ---
  const handleCopySettings = async () => {
    const settings = {
      layoutScale: layoutScalePreset,
      ...sim.getSettingsJSON()
    };
    const json = JSON.stringify(settings, null, 2);
    let copySuccess = false;

    try {
      if (window.electron?.clipboard?.writeText) {
        await window.electron.clipboard.writeText(json);
        copySuccess = true;
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
        copySuccess = true;
      }
    } catch (err) {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = json;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        copySuccess = document.execCommand('copy');
        document.body.removeChild(textArea);
      } catch (_) { /* all methods failed */ }
    }

    if (!copySuccess) {
      alert('Failed to copy to clipboard. Use "Show JSON" and copy manually.');
    }
  };

  // --- Early returns ---
  if (!isOpen) return null;
  if (invisible) return null;

  const darkClass = theme.darkMode ? 'force-sim-dark' : '';

  return (
    <div
      ref={modalRef}
      className={`force-sim-modal ${darkClass}`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        cursor: isDragging ? 'grabbing' : 'default'
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Header */}
      <div className="force-sim-header" style={{ cursor: 'grab' }}>
        <h3>Force Simulation Tuner</h3>
        <button className="force-sim-close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <div className="force-sim-body">
        {/* Stats */}
        <div className="force-sim-stats-box">
          <div className="force-sim-stat">
            <span className="force-sim-stat-label">Iteration</span>
            <span className="force-sim-stat-value">{sim.iteration}</span>
          </div>
          <div className="force-sim-stat">
            <span className="force-sim-stat-label">Alpha</span>
            <span className="force-sim-stat-value">{sim.alpha.toFixed(4)}</span>
          </div>
          <div className="force-sim-stat">
            <span className="force-sim-stat-label">Status</span>
            <span className={`force-sim-stat-value ${sim.isRunning ? 'running' : ''}`}>
              {sim.isRunning ? 'Running' : 'Paused'}
            </span>
          </div>
        </div>

        {/* Info */}
        <div className="force-sim-info">
          <Info size={14} />
          <span><strong>Edge Avoidance</strong> pushes nodes away from crossing over edges. <strong>Min Link Length</strong> keeps connected nodes apart.</span>
        </div>

        {/* Control buttons */}
        <div className="force-sim-buttons">
          <button className="force-sim-btn" onClick={sim.toggleRunning}>
            {sim.isRunning ? <Pause size={14} /> : <Play size={14} />}
            {sim.isRunning ? 'Pause' : 'Play'}
          </button>
          <button className="force-sim-btn" onClick={sim.reset}>
            <RotateCcw size={14} />
            Reset
          </button>
          <button className="force-sim-btn" onClick={sim.randomize}>
            <Shuffle size={14} />
            Randomize
          </button>
          <button className="force-sim-btn" onClick={handleCopySettings}>
            <Copy size={14} />
            Copy
          </button>
          <button className="force-sim-btn" onClick={() => setShowJson(!showJson)}>
            {showJson ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showJson ? 'Hide JSON' : 'Show JSON'}
          </button>
        </div>

        {/* JSON export */}
        {showJson && (
          <div className="force-sim-json-container">
            <textarea
              readOnly
              value={JSON.stringify({ layoutScale: layoutScalePreset, ...sim.getSettingsJSON() }, null, 2)}
              className="force-sim-json-textarea"
              onClick={(e) => e.target.select()}
            />
          </div>
        )}

        {/* Iteration presets */}
        <div className="force-sim-preset-section">
          <div className="force-sim-preset-label">Layout Iterations</div>
          <div className="settings-option-group">
            {sim.iterationPresetEntries.map(([key, preset]) => (
              <button
                key={key}
                type="button"
                className={`settings-option-btn ${sim.iterationPreset === key ? 'active' : ''}`}
                onClick={() => sim.handleIterationPresetChange(key)}
              >
                {key === 'fast' ? 'Fast' : key === 'deep' ? 'Deep' : 'Balanced'}
              </button>
            ))}
          </div>
        </div>

        {/* Layout Scale + Speed */}
        <div className="force-sim-slider-section">
          <MaroonSlider
            label="Layout Scale"
            value={sim.scaleMultiplier}
            min={0.2}
            max={MAX_LAYOUT_SCALE_MULTIPLIER}
            step={0.05}
            onChange={(v) => sim.handleScaleMultiplierChange(v)}
            displayValue={sim.scaleMultiplier.toFixed(2)}
            suffix="x"
          />
          <div className="force-sim-quick-presets">
            {sim.scalePresetEntries.map(([key, preset]) => (
              <button
                key={key}
                type="button"
                className={`settings-option-btn ${layoutScalePreset === key ? 'active' : ''}`}
                onClick={() => sim.handleScalePresetChange(key)}
              >
                {preset.label}
              </button>
            ))}
            <button type="button" className="settings-option-btn" onClick={sim.handleResetScale}>
              Reset
            </button>
          </div>

          <MaroonSlider
            label="Speed"
            value={sim.simulationSpeed}
            min={0.1}
            max={3.0}
            step={0.1}
            onChange={(v) => sim.setSimulationSpeed(v)}
            displayValue={sim.simulationSpeed.toFixed(1)}
            suffix="x"
          />
          <div className="force-sim-quick-presets">
            <button type="button" className="settings-option-btn" onClick={() => sim.setSimulationSpeed(0.5)}>0.5x</button>
            <button type="button" className="settings-option-btn" onClick={() => sim.setSimulationSpeed(1.0)}>1x</button>
            <button type="button" className="settings-option-btn" onClick={() => sim.setSimulationSpeed(2.0)}>2x</button>
          </div>
        </div>

        {/* Force parameters */}
        <div className="force-sim-slider-section">
          <div className="settings-section-subtitle">Force Parameters</div>

          <MaroonSlider
            label="Repulsion"
            value={sim.params.repulsionStrength}
            min={200} max={4000} step={100}
            onChange={(v) => sim.setParams({ repulsionStrength: v })}
          />
          <MaroonSlider
            label="Attraction"
            value={sim.params.attractionStrength}
            min={0.05} max={1} step={0.05}
            onChange={(v) => sim.setParams({ attractionStrength: v })}
            displayValue={sim.params.attractionStrength.toFixed(2)}
          />
          <MaroonSlider
            label="Link Distance"
            value={sim.params.linkDistance}
            min={80} max={500} step={10}
            onChange={(v) => {
              sim.setParams({
                linkDistance: v,
                minLinkDistance: Math.min(sim.params.minLinkDistance, Math.max(60, v - 20))
              });
            }}
            displayValue={Math.round(sim.params.linkDistance * sim.scaleMultiplier)}
            suffix="px"
          />
          <MaroonSlider
            label="Min Link Length"
            value={sim.params.minLinkDistance}
            min={60} max={Math.max(80, sim.params.linkDistance - 20)} step={10}
            onChange={(v) => sim.setParams({ minLinkDistance: v })}
            displayValue={Math.round(sim.params.minLinkDistance * sim.scaleMultiplier)}
            suffix="px"
          />
          <MaroonSlider
            label="Damping"
            value={sim.params.velocityDecay}
            min={0.3} max={0.9} step={0.05}
            onChange={(v) => sim.setParams({ velocityDecay: v })}
            displayValue={sim.params.velocityDecay.toFixed(2)}
          />
          <MaroonSlider
            label="Node Size"
            value={sim.params.collisionRadius}
            min={40} max={150} step={5}
            onChange={(v) => sim.setParams({ collisionRadius: v })}
            displayValue={Math.round(sim.params.collisionRadius * sim.scaleMultiplier)}
            suffix="px"
          />
          <MaroonSlider
            label="Edge Avoidance"
            value={sim.params.edgeAvoidance}
            min={0} max={1} step={0.05}
            onChange={(v) => sim.setParams({ edgeAvoidance: v })}
            displayValue={sim.params.edgeAvoidance.toFixed(2)}
          />
          <MaroonSlider
            label="Center Pull"
            value={sim.params.centerStrength}
            min={0} max={0.3} step={0.01}
            onChange={(v) => sim.setParams({ centerStrength: v })}
            displayValue={sim.params.centerStrength.toFixed(2)}
          />
          <MaroonSlider
            label="Cooling Rate"
            value={sim.params.alphaDecay}
            min={0.005} max={0.05} step={0.001}
            onChange={(v) => sim.setParams({ alphaDecay: v })}
            displayValue={sim.params.alphaDecay.toFixed(3)}
          />
          <MaroonSlider
            label="Stiffness"
            value={sim.params.stiffness}
            min={0} max={1} step={0.05}
            onChange={(v) => sim.setParams({ stiffness: v })}
            displayValue={sim.params.stiffness.toFixed(2)}
          />
        </div>

        {/* Group Forces */}
        <div className="force-sim-slider-section">
          <div className="settings-section-subtitle">Group Forces</div>

          <MaroonSlider
            label="Group Attraction"
            value={sim.params.groupAttractionStrength}
            min={0} max={2.0} step={0.05}
            onChange={(v) => sim.setParams({ groupAttractionStrength: v })}
            displayValue={sim.params.groupAttractionStrength.toFixed(2)}
          />
          <MaroonSlider
            label="Group Repulsion"
            value={sim.params.groupRepulsionStrength}
            min={0} max={5} step={0.1}
            onChange={(v) => sim.setParams({ groupRepulsionStrength: v })}
            displayValue={sim.params.groupRepulsionStrength.toFixed(2)}
          />
          <MaroonSlider
            label="Group Exclusion"
            value={sim.params.groupExclusionStrength}
            min={0} max={5} step={0.1}
            onChange={(v) => sim.setParams({ groupExclusionStrength: v })}
            displayValue={sim.params.groupExclusionStrength.toFixed(2)}
          />
          <MaroonSlider
            label="Min Group Distance"
            value={sim.params.minGroupDistance}
            min={100} max={1500} step={25}
            onChange={(v) => sim.setParams({ minGroupDistance: v })}
            displayValue={Math.round(sim.params.minGroupDistance)}
            suffix="px"
          />
          <MaroonSlider
            label="Group Padding"
            value={sim.params.groupBoundaryPadding}
            min={0} max={150} step={10}
            onChange={(v) => sim.setParams({ groupBoundaryPadding: v })}
            displayValue={Math.round(sim.params.groupBoundaryPadding)}
            suffix="px"
          />
        </div>
      </div>
    </div>
  );
};

export default ForceSimulationModal;
