import React, { useState } from 'react';
import CanvasModal from './CanvasModal';
import MaroonSlider from './MaroonSlider.jsx';
import useGraphStore from '../store/graphStore.jsx';
import { useTheme } from '../hooks/useTheme.js';
import { Monitor, Grid3x3, Cable, Keyboard, Type, Brain } from 'lucide-react';
import AISection from './settings/AISection.jsx';
import './SettingsModal.css';

/**
 * Settings Modal
 * Full-screen overlay with two-column layout for app settings.
 * Reads/writes settings directly via useGraphStore.
 */
const SettingsModal = ({ isVisible, onClose }) => {
  const theme = useTheme();
  const [activeSection, setActiveSection] = useState('display');
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 900
  }));

  React.useEffect(() => {
    const handleResize = () => {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle opening to specific section via event
  React.useEffect(() => {
    const handleOpenSettings = (e) => {
      if (e.detail?.section && sections[e.detail.section]) {
        setActiveSection(e.detail.section);
      }
    };
    window.addEventListener('openSettingsModal', handleOpenSettings);
    return () => window.removeEventListener('openSettingsModal', handleOpenSettings);
  }, []);

  // Pull live state from the store for reactive rendering
  const gridMode = useGraphStore(s => s.gridMode);
  const gridSize = useGraphStore(s => s.gridSize);
  const dragZoomEnabled = useGraphStore(s => s.dragZoomEnabled);
  const dragZoomAmount = useGraphStore(s => s.dragZoomAmount);
  const textSettings = useGraphStore(s => s.textSettings);
  const keyboardSettings = useGraphStore(s => s.keyboardSettings);
  const routingStyle = useGraphStore(s => s.routingStyle);
  const cleanLaneSpacing = useGraphStore(s => s.cleanLaneSpacing);
  const showConnectionNames = useGraphStore(s => s.showConnectionNames);
  const darkMode = useGraphStore(s => s.darkMode);

  const isCompactLayout = viewportSize.width <= 768;
  const modalWidth = isCompactLayout
    ? Math.min(Math.max(viewportSize.width - 24, 320), 600)
    : 750;
  const modalHeight = isCompactLayout
    ? Math.min(Math.max(viewportSize.height * 0.85, 400), 600)
    : 600;

  // Toggle helper
  const Toggle = ({ checked, onChange }) => (
    <label className="settings-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="settings-toggle-track" />
      <span className="settings-toggle-thumb" />
    </label>
  );

  // Option group helper
  const OptionGroup = ({ options, value, onChange }) => (
    <div className="settings-option-group">
      {options.map(opt => (
        <button
          key={opt.value}
          className={`settings-option-btn ${value === opt.value ? 'active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  // Icon map for sidebar navigation
  const sectionIcons = {
    ai: <Brain size={16} style={{ minWidth: '16px', flexShrink: 0 }} />,
    display: <Monitor size={16} style={{ minWidth: '16px', flexShrink: 0 }} />,
    grid: <Grid3x3 size={16} style={{ minWidth: '16px', flexShrink: 0 }} />,
    connections: <Cable size={16} style={{ minWidth: '16px', flexShrink: 0 }} />,
    keyboard: <Keyboard size={16} style={{ minWidth: '16px', flexShrink: 0 }} />,
    text: <Type size={16} style={{ minWidth: '16px', flexShrink: 0 }} />
  };

  const sections = {
    ai: {
      title: 'AI & API Keys',
      content: <AISection />
    },
    display: {
      title: 'Display',
      content: (
        <div>
          <div className="settings-row">
            <div className="settings-row-label">
              Dark Mode
              <div className="settings-row-description">Use dark background color</div>
            </div>
            <Toggle
              checked={!!darkMode}
              onChange={() => useGraphStore.getState().toggleDarkMode?.()}
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              Show Connection Names
              <div className="settings-row-description">Display labels on connections</div>
            </div>
            <Toggle
              checked={!!showConnectionNames}
              onChange={() => useGraphStore.getState().toggleShowConnectionNames?.()}
            />
          </div>
        </div>
      )
    },
    grid: {
      title: 'Grid',
      content: (
        <div>
          <div className="settings-row">
            <div className="settings-row-label">Grid Mode</div>
            <OptionGroup
              options={[
                { label: 'Off', value: 'off' },
                { label: 'On Move', value: 'hover' },
                { label: 'Always', value: 'always' }
              ]}
              value={gridMode || 'off'}
              onChange={(v) => useGraphStore.getState().setGridMode?.(v)}
            />
          </div>
          <div className="settings-slider-row">
            <MaroonSlider
              label="Grid Size"
              value={gridSize || 200}
              min={20}
              max={400}
              step={5}
              suffix="px"
              onChange={(v) => useGraphStore.getState().setGridSize?.(v)}
            />
          </div>
        </div>
      )
    },
    connections: {
      title: 'Connections',
      content: (
        <div>
          <div className="settings-row">
            <div className="settings-row-label">Routing Style</div>
            <OptionGroup
              options={[
                { label: 'Straight', value: 'straight' },
                { label: 'Manhattan', value: 'manhattan' },
                { label: 'Clean', value: 'clean' }
              ]}
              value={routingStyle || 'straight'}
              onChange={(v) => useGraphStore.getState().setRoutingStyle?.(v)}
            />
          </div>
          {routingStyle === 'clean' && (
            <div className="settings-slider-row">
              <MaroonSlider
                label="Connection Spacing"
                value={cleanLaneSpacing || 200}
                min={100}
                max={400}
                step={10}
                suffix="px"
                onChange={(v) => useGraphStore.getState().setCleanLaneSpacing?.(v)}
              />
            </div>
          )}
        </div>
      )
    },
    keyboard: {
      title: 'Keyboard & Input',
      content: (
        <div>
          <div className="settings-section-subtitle">Keyboard</div>
          <div className="settings-slider-row">
            <MaroonSlider
              label="Zoom Sensitivity"
              value={keyboardSettings?.zoomSensitivity ?? 0.5}
              min={0.1}
              max={1.0}
              step={0.05}
              onChange={(v) => useGraphStore.getState().setKeyboardZoomSensitivity?.(v)}
              suffix=""
            />
          </div>
          <div className="settings-slider-row">
            <MaroonSlider
              label="Pan Sensitivity"
              value={keyboardSettings?.panSensitivity ?? 0.5}
              min={0.1}
              max={1.0}
              step={0.05}
              onChange={(v) => useGraphStore.getState().setKeyboardPanSensitivity?.(v)}
              suffix=""
            />
          </div>

          <hr className="settings-section-divider" />

          <div className="settings-section-subtitle">Zoom on Drag</div>
          <div className="settings-row">
            <div className="settings-row-label">
              Enable Zoom on Drag
              <div className="settings-row-description">Zoom out when dragging a node</div>
            </div>
            <Toggle
              checked={!!dragZoomEnabled}
              onChange={() => useGraphStore.getState().toggleDragZoomEnabled?.()}
            />
          </div>
          <div className="settings-slider-row">
            <MaroonSlider
              label="Zoom Amount"
              value={dragZoomAmount ?? 0.3}
              min={0.0}
              max={0.9}
              step={0.05}
              onChange={(v) => useGraphStore.getState().setDragZoomAmount?.(v)}
              disabled={!dragZoomEnabled}
              suffix=""
            />
          </div>
        </div>
      )
    },
    text: {
      title: 'Text',
      content: (
        <div>
          <div className="settings-slider-row">
            <MaroonSlider
              label="Font Size"
              value={textSettings?.fontSize ?? 1.0}
              min={0.7}
              max={1.4}
              step={0.05}
              suffix="x"
              onChange={(v) => useGraphStore.getState().setTextFontSize?.(v)}
            />
          </div>
          <div className="settings-slider-row">
            <MaroonSlider
              label="Line Spacing"
              value={textSettings?.lineSpacing ?? 0.85}
              min={0.7}
              max={1.0}
              step={0.05}
              suffix="x"
              onChange={(v) => useGraphStore.getState().setTextLineSpacing?.(v)}
            />
          </div>
        </div>
      )
    }
  };

  const modalContent = (
    <div
      className={theme.darkMode ? 'settings-dark' : ''}
      style={{
        display: 'flex',
        height: '100%',
        fontFamily: "'EmOne', sans-serif",
        fontSize: isCompactLayout ? '0.85rem' : '0.9rem'
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        onTouchEnd={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
        style={{
          position: 'absolute',
          top: isCompactLayout ? '12px' : '16px',
          right: isCompactLayout ? '32px' : '40px',
          background: 'none',
          border: 'none',
          color: theme.canvas.textSecondary,
          cursor: 'pointer',
          padding: '6px',
          borderRadius: '4px',
          fontSize: '16px',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif",
          zIndex: 10,
          touchAction: 'manipulation'
        }}
        onMouseEnter={(e) => e.currentTarget.style.color = theme.canvas.textPrimary}
        onMouseLeave={(e) => e.currentTarget.style.color = theme.canvas.textSecondary}
      >
        ✕
      </button>

      {/* Sidebar Navigation */}
      {!isCompactLayout && (
        <div
          className="settings-modal-sidebar"
          style={{
            width: '180px',
            borderRight: `1px solid ${theme.canvas.border}`,
            padding: '20px 12px',
            overflowY: 'auto',
            flexShrink: 0
          }}
        >
          <h3 style={{
            margin: '0 0 16px 0',
            fontSize: '1.1rem',
            color: theme.canvas.textPrimary
          }}>
            Settings
          </h3>
          {Object.keys(sections).map((key) => (
            <div
              key={key}
              onClick={() => setActiveSection(key)}
              style={{
                padding: '10px 12px',
                marginBottom: '4px',
                borderRadius: '6px',
                cursor: 'pointer',
                backgroundColor: activeSection === key ? (theme.darkMode ? 'rgba(139, 0, 0, 0.25)' : 'rgba(139, 0, 0, 0.1)') : 'transparent',
                color: activeSection === key ? (theme.darkMode ? '#ff9a9a' : theme.accent.primary) : theme.canvas.textSecondary,
                fontWeight: activeSection === key ? 'bold' : 'normal',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                if (activeSection !== key) {
                  e.currentTarget.style.backgroundColor = theme.darkMode ? 'rgba(139, 0, 0, 0.12)' : 'rgba(139, 0, 0, 0.05)';
                }
              }}
              onMouseLeave={(e) => {
                if (activeSection !== key) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }
              }}
            >
              {sectionIcons[key]}
              {sections[key].title}
            </div>
          ))}
        </div>
      )}

      {/* Main Content Area */}
      <div
        className="settings-modal-content"
        style={{
          flex: 1,
          padding: isCompactLayout ? '16px' : '24px',
          paddingTop: isCompactLayout ? '40px' : '24px',
          paddingRight: isCompactLayout ? '24px' : '32px',
          overflowY: 'auto'
        }}
      >
        {/* Mobile Section Selector */}
        {isCompactLayout && (
          <div style={{ marginBottom: '20px' }}>
            <select
              value={activeSection}
              onChange={(e) => setActiveSection(e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '6px',
                border: `1px solid ${theme.canvas.border}`,
                backgroundColor: theme.darkMode ? theme.canvas.hover : 'white',
                fontSize: '0.9rem',
                fontFamily: "'EmOne', sans-serif",
                color: theme.canvas.textPrimary
              }}
            >
              {Object.keys(sections).map((key) => (
                <option key={key} value={key}>
                  {sections[key].title}
                </option>
              ))}
            </select>
          </div>
        )}

        <h2 style={{
          margin: '0 0 20px 0',
          color: theme.canvas.textPrimary,
          fontSize: isCompactLayout ? '1.3rem' : '1.5rem'
        }}>
          {sections[activeSection].title}
        </h2>

        <div style={{
          lineHeight: '1.6',
          color: theme.canvas.textSecondary
        }}>
          {sections[activeSection].content}
        </div>
      </div>
    </div>
  );

  return (
    <CanvasModal
      isVisible={isVisible}
      onClose={onClose}
      title=""
      width={modalWidth}
      height={modalHeight}
      position="center"
      margin={isCompactLayout ? 12 : 20}
      fullScreenOverlay={true}
    >
      {modalContent}
    </CanvasModal>
  );
};

export default SettingsModal;
