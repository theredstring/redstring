import React, { useRef, useState } from 'react';
import CanvasModal from './CanvasModal';
import MaroonSlider from './MaroonSlider.jsx';
import useGraphStore, { TRACKPAD_PAN_GLIDE_STRENGTH_DEFAULT } from '../store/graphStore.js';
import { useTheme } from '../hooks/useTheme.js';
import { Monitor, Grid3x3, Cable, Keyboard, Scaling, PanelBottom, Brain, Info, Bug, X } from 'lucide-react';
import AISection from './settings/AISection.jsx';
import DebugSection from './settings/DebugSection.jsx';
import PanelIconButton from './shared/PanelIconButton.jsx';
import { isDebugSettingsUnlocked, setDebugSettingsUnlocked } from '../utils/debugUnlock.js';
import { DEFAULT_CONNECTION_LABEL_COLOR_MODE, DEFAULT_CONNECTION_LABEL_OUTER_RING, DEFAULT_CONNECTION_LABEL_RING_WIDTH, CONNECTION_LABEL_RING_WIDTH_MIN, CONNECTION_LABEL_RING_WIDTH_MAX, DEFAULT_CONNECTION_LABEL_MOVE_FADE, DEFAULT_CONNECTION_LABEL_TRUNCATE } from '../utils/colorUtils.js';
import './ModalChrome.css';

/**
 * How the Debug page is reached: five taps on About, either on the sidebar item
 * or on the version number — the version is the only one of the two a phone
 * has, since the sidebar collapses to a <select> there and re-picking the
 * option it already shows fires nothing.
 */
const DEBUG_UNLOCK_TAPS = 5;

/**
 * Settings Modal
 * Full-screen overlay with two-column layout for app settings.
 * Reads/writes settings directly via useGraphStore.
 */
const SettingsModal = ({ isVisible, onClose }) => {
  const theme = useTheme();
  const [activeSection, setActiveSection] = useState('display');
  const [debugUnlocked, setDebugUnlocked] = useState(isDebugSettingsUnlocked);
  const [aboutTaps, setAboutTaps] = useState(0);
  // The header logo's context menu can flip this while the modal is mounted but
  // hidden, so re-read on the way in rather than trusting the mount-time value.
  const sectionsRef = useRef(null);
  React.useEffect(() => {
    if (!isVisible) return;
    setDebugUnlocked(isDebugSettingsUnlocked());
    setAboutTaps(0);
  }, [isVisible]);
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
      const requested = e.detail?.section;
      if (!requested) return;
      // Debug is asked for by the same gesture that reveals it, so this render
      // has not built the section yet. Trust the stored flag instead.
      if (requested === 'debug') {
        if (!isDebugSettingsUnlocked()) return;
        setDebugUnlocked(true);
        setActiveSection('debug');
        return;
      }
      // Everything else goes through a ref: `sections` changes shape after this
      // listener is bound, and the closure holds the first render's copy.
      if (sectionsRef.current?.[requested]) setActiveSection(requested);
    };
    window.addEventListener('openSettingsModal', handleOpenSettings);
    return () => window.removeEventListener('openSettingsModal', handleOpenSettings);
  }, []);

  // Pull live state from the store for reactive rendering
  const gridMode = useGraphStore(s => s.gridSettings?.mode);
  const gridSize = useGraphStore(s => s.gridSettings?.size);
  const gridSnapMode = useGraphStore(s => s.gridSettings?.snapMode);
  const gridAppearance = useGraphStore(s => s.gridSettings?.appearance);
  const dragZoomEnabled = useGraphStore(s => s.dragZoomSettings?.enabled);
  const dragZoomAmount = useGraphStore(s => s.dragZoomSettings?.zoomAmount);
  const focusOnSelectEnabled = useGraphStore(s => s.focusOnSelectEnabled !== false);
  const focusOnSelectZoomAmount = useGraphStore(s => s.focusOnSelectZoomAmount ?? 1.0);
  const textSettings = useGraphStore(s => s.textSettings);
  const keyboardSettings = useGraphStore(s => s.keyboardSettings);
  const touchSettings = useGraphStore(s => s.touchSettings);
  const middleMouseZoomEnabled = useGraphStore(s => s.mouseSettings?.middleMouseZoomEnabled ?? false);
  const nodeDragEdgePanEnabled = useGraphStore(s => s.mouseSettings?.nodeDragEdgePanEnabled ?? true);
  const connectionDrawEdgePanEnabled = useGraphStore(s => s.mouseSettings?.connectionDrawEdgePanEnabled ?? true);
  const mouseGlideEnabled = useGraphStore(s => s.mouseSettings?.glideEnabled ?? true);
  const touchGlideEnabled = useGraphStore(s => s.touchSettings?.glideEnabled ?? true);
  const trackpadZoomSensitivity = useGraphStore(s => s.touchSettings?.trackpadZoomSensitivity ?? 0.5);
  const trackpadPanSensitivity = useGraphStore(s => s.touchSettings?.trackpadPanSensitivity ?? 0.5);
  const trackpadZoomGlideEnabled = useGraphStore(s => s.touchSettings?.trackpadZoomGlideEnabled ?? true);
  const trackpadZoomGlideStrength = useGraphStore(s => s.touchSettings?.trackpadZoomGlideStrength ?? 0.5);
  const trackpadPanGlideEnabled = useGraphStore(s => s.touchSettings?.trackpadPanGlideEnabled ?? true);
  const trackpadPanGlideStrength = useGraphStore(s => s.touchSettings?.trackpadPanGlideStrength ?? TRACKPAD_PAN_GLIDE_STRENGTH_DEFAULT);
  const mouseGlideStrength = useGraphStore(s => s.mouseSettings?.glideStrength ?? 0.5);
  const nodeLiftDelay = useGraphStore(s => s.mouseSettings?.nodeLiftDelay ?? 250);
  const touchGlideStrength = useGraphStore(s => s.touchSettings?.glideStrength ?? 0.5);
  const touchPinchGlideEnabled = useGraphStore(s => s.touchSettings?.pinchGlideEnabled ?? true);
  const touchPinchGlideStrength = useGraphStore(s => s.touchSettings?.pinchGlideStrength ?? 0.5);
  // These live under autoLayoutSettings, like lombardiCurvature below. Reading
  // them off the store root returned undefined every time, so the Routing Style
  // control always rendered its 'straight' fallback no matter what was set.
  const routingStyle = useGraphStore(s => s.autoLayoutSettings?.routingStyle ?? 'straight');
  const cleanLaneSpacing = useGraphStore(s => s.autoLayoutSettings?.cleanLaneSpacing ?? 200);
  const manhattanBends = useGraphStore(s => s.autoLayoutSettings?.manhattanBends ?? 'auto');
  const lombardiCurvature = useGraphStore(s => s.autoLayoutSettings?.lombardiCurvature ?? 1.0);
  const multiConnectionCurve = useGraphStore(s => s.autoLayoutSettings?.multiConnectionCurve ?? 1.0);
  const showConnectionNames = useGraphStore(s => s.showConnectionNames);
  const connectionLabelSize = useGraphStore(s => s.connectionLabelSize ?? 1.0);
  const connectionLabelColorMode = useGraphStore(s => s.connectionLabelColorMode ?? DEFAULT_CONNECTION_LABEL_COLOR_MODE);
  const connectionLabelMoveFade = useGraphStore(s => s.connectionLabelMoveFade ?? DEFAULT_CONNECTION_LABEL_MOVE_FADE);
  const connectionLabelOuterRing = useGraphStore(s => s.connectionLabelOuterRing ?? DEFAULT_CONNECTION_LABEL_OUTER_RING);
  const connectionLabelRingWidth = useGraphStore(s => s.connectionLabelRingWidth ?? DEFAULT_CONNECTION_LABEL_RING_WIDTH);
  const connectionLabelTruncate = useGraphStore(s => s.connectionLabelTruncate ?? DEFAULT_CONNECTION_LABEL_TRUNCATE);
  const showEdgeGlowIndicators = useGraphStore(s => s.showEdgeGlowIndicators);
  const darkMode = useGraphStore(s => s.darkMode);
  const showHoverPreview = useGraphStore(s => s.showHoverPreview ?? true);
  const hoverPreviewZoomOnly = useGraphStore(s => s.hoverPreviewZoomOnly ?? true);
  const hoverPreviewSize = useGraphStore(s => s.hoverPreviewSize ?? 1.0);
  const showNodeControlPanel = useGraphStore(s => s.showNodeControlPanel ?? false);
  const showMultipleNodesControlPanel = useGraphStore(s => s.showMultipleNodesControlPanel ?? true);
  const showConnectionControlPanel = useGraphStore(s => s.showConnectionControlPanel ?? false);
  const showGroupControlPanel = useGraphStore(s => s.showGroupControlPanel ?? true);
  const showAbstractionControlPanel = useGraphStore(s => s.showAbstractionControlPanel ?? true);

  // Counting happens on the way in, so the fifth tap is the one that reveals it.
  const registerAboutTap = () => {
    if (debugUnlocked) return;
    const next = aboutTaps + 1;
    if (next >= DEBUG_UNLOCK_TAPS) {
      setDebugSettingsUnlocked(true);
      setDebugUnlocked(true);
      setAboutTaps(0);
      return;
    }
    setAboutTaps(next);
  };

  const relockDebug = () => {
    setDebugSettingsUnlocked(false);
    // Leave first — the section this is called from is about to stop existing.
    setActiveSection('about');
    setDebugUnlocked(false);
    setAboutTaps(0);
  };

  const isCompactLayout = viewportSize.width <= 768;
  const modalWidth = isCompactLayout
    ? Math.min(Math.max(viewportSize.width - 24, 320), 600)
    : 750;
  const modalHeight = isCompactLayout
    ? Math.min(Math.max(viewportSize.height * 0.85, 400), 600)
    : 600;

  // Toggle helper
  const Toggle = ({ checked, onChange, disabled = false }) => (
    <label className="settings-toggle" style={disabled ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="settings-toggle-track" />
      <span className="settings-toggle-thumb" />
    </label>
  );

  // Option group helper
  //
  // A radio group built out of the panel's pill button, `active` marking the
  // chosen one. This is the same construction as the Concepts/Related switch in
  // the Semantic Discovery view: the selected pill wears the pie menu's lit
  // state, so "selected" and "hovered" are one visual idea rather than two.
  const OptionGroup = ({ options, value, onChange }) => (
    <div className="settings-option-group">
      {options.map(opt => (
        <PanelIconButton
          key={opt.value}
          label={opt.label}
          labelFontSize={11}
          variant="outline"
          active={value === opt.value}
          onClick={() => onChange(opt.value)}
          style={{ padding: '5px 12px' }}
        />
      ))}
    </div>
  );

  // Icon map for sidebar navigation
  const sectionIcons = {
    ai: <Brain size={16} style={{ minWidth: '16px', flexShrink: 0 }} />,
    display: <Monitor size={16} style={{ minWidth: '16px', flexShrink: 0 }} />,
    size: <Scaling size={16} style={{ minWidth: '16px', flexShrink: 0 }} />,
    panels: <PanelBottom size={16} style={{ minWidth: '16px', flexShrink: 0 }} />,
    grid: <Grid3x3 size={16} style={{ minWidth: '16px', flexShrink: 0 }} />,
    connections: <Cable size={16} style={{ minWidth: '16px', flexShrink: 0 }} />,
    keyboard: <Keyboard size={16} style={{ minWidth: '16px', flexShrink: 0 }} />,
    about: <Info size={16} style={{ minWidth: '16px', flexShrink: 0 }} />,
    debug: <Bug size={16} style={{ minWidth: '16px', flexShrink: 0 }} />
  };

  const tapsRemaining = DEBUG_UNLOCK_TAPS - aboutTaps;

  const sections = {
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
              Offscreen Thing Glow Indicators
              <div className="settings-row-description">Glow indicators on canvas edges for Things outside the viewport. Disable to improve panning performance on large Webs.</div>
            </div>
            <Toggle
              checked={!!showEdgeGlowIndicators}
              onChange={() => useGraphStore.getState().toggleShowEdgeGlowIndicators?.()}
            />
          </div>
          <div className="settings-row settings-row--attached">
            <div className="settings-row-label">
              Hover Preview
              <div className="settings-row-description">Show a preview of the hovered Thing when hovering inside an expanded Thing's network.</div>
            </div>
            <Toggle
              checked={!!showHoverPreview}
              onChange={() => useGraphStore.getState().toggleShowHoverPreview?.()}
            />
          </div>
          <div className="settings-row settings-row--attached">
            <div className="settings-row-label">
              Only When Zoomed Out
              <div className="settings-row-description">Only show the hover preview when zoomed out far enough that on-canvas text is small. When off, it shows at any zoom level.</div>
            </div>
            <Toggle
              checked={!!hoverPreviewZoomOnly}
              disabled={!showHoverPreview}
              onChange={() => useGraphStore.getState().toggleHoverPreviewZoomOnly?.()}
            />
          </div>
          <div className="settings-slider-row">
            <MaroonSlider
              label="Hover Preview Size"
              value={hoverPreviewSize ?? 1.0}
              min={0.5}
              max={1.5}
              step={0.05}
              suffix="x"
              disabled={!showHoverPreview}
              onChange={(v) => useGraphStore.getState().setHoverPreviewSize?.(v)}
            />
          </div>
        </div>
      )
    },
    size: {
      title: 'Size',
      content: (
        <div>
          <div className="settings-section-subtitle">Nodes &amp; Menus</div>
          <div className="settings-slider-row">
            <MaroonSlider
              label="Node Size"
              value={textSettings?.nodeScale ?? 1.0}
              min={0.5}
              max={2.0}
              step={0.05}
              suffix="x"
              onChange={(v) => useGraphStore.getState().setNodeScale?.(v)}
            />
          </div>
          <div className="settings-slider-row">
            <MaroonSlider
              label="Plus Sign Size"
              value={textSettings?.plusSignScale ?? 1.0}
              min={0.25}
              max={3.0}
              step={0.05}
              suffix="x"
              onChange={(v) => useGraphStore.getState().setPlusSignScale?.(v)}
            />
          </div>
          <div className="settings-slider-row">
            <MaroonSlider
              label="Pie Menu Size"
              value={textSettings?.pieMenuScale ?? 1.0}
              min={0.25}
              max={3.0}
              step={0.05}
              suffix="x"
              onChange={(v) => useGraphStore.getState().setPieMenuScale?.(v)}
            />
          </div>

          <hr className="settings-section-divider" />

          <div className="settings-section-subtitle">Text</div>
          <div className="settings-slider-row">
            <MaroonSlider
              label="Font Size"
              value={textSettings?.fontSize ?? 1.0}
              min={0.7}
              max={2.0}
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
              max={2.0}
              step={0.05}
              suffix="x"
              onChange={(v) => useGraphStore.getState().setTextLineSpacing?.(v)}
            />
          </div>

          <hr className="settings-section-divider" />

          <div className="settings-section-subtitle">Connections</div>
          <div className="settings-slider-row">
            <MaroonSlider
              label="Label Size"
              value={connectionLabelSize}
              min={0.5}
              max={2.0}
              step={0.05}
              suffix="x"
              disabled={!showConnectionNames}
              onChange={(v) => useGraphStore.getState().setConnectionLabelSize?.(v)}
            />
          </div>
          <div className="settings-slider-row">
            <MaroonSlider
              label="Connection Width"
              value={textSettings?.connectionWidth ?? 1.0}
              min={0.25}
              max={4.0}
              step={0.05}
              suffix="x"
              onChange={(v) => useGraphStore.getState().setConnectionWidth?.(v)}
            />
          </div>
        </div>
      )
    },
    panels: {
      title: 'Panels',
      content: (
        <div>
          <div className="settings-row">
            <div className="settings-row-label">
              Thing Panel
              <div className="settings-row-description">Show the bottom control panel when a single Thing is selected</div>
            </div>
            <Toggle
              checked={showNodeControlPanel}
              onChange={() => useGraphStore.getState().toggleShowNodeControlPanel?.()}
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              Multiple Things Panel
              <div className="settings-row-description">Show the bottom control panel when multiple Things are selected</div>
            </div>
            <Toggle
              checked={showMultipleNodesControlPanel}
              onChange={() => useGraphStore.getState().toggleShowMultipleNodesControlPanel?.()}
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              Connection Panel
              <div className="settings-row-description">Show the bottom control panel when a connection is selected</div>
            </div>
            <Toggle
              checked={showConnectionControlPanel}
              onChange={() => useGraphStore.getState().toggleShowConnectionControlPanel?.()}
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              Group Panel
              <div className="settings-row-description">Show the bottom control panel when a group is selected</div>
            </div>
            <Toggle
              checked={showGroupControlPanel}
              onChange={() => useGraphStore.getState().toggleShowGroupControlPanel?.()}
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              Abstraction Panel
              <div className="settings-row-description">Show the bottom control panel when the abstraction carousel is open</div>
            </div>
            <Toggle
              checked={showAbstractionControlPanel}
              onChange={() => useGraphStore.getState().toggleShowAbstractionControlPanel?.()}
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
                { label: 'On Move', value: 'move' },
                { label: 'Always', value: 'always' }
              ]}
              value={gridMode || 'off'}
              onChange={(v) => useGraphStore.getState().setGridMode?.(v)}
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-label">Grid Appearance</div>
            <OptionGroup
              options={[
                { label: 'Lattice', value: 'lattice' },
                { label: 'Dot', value: 'dot' }
              ]}
              value={gridAppearance || 'lattice'}
              onChange={(v) => useGraphStore.getState().setGridAppearance?.(v)}
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
          <div className="settings-row">
            <div className="settings-row-label">
              Snap to Grid
              <div className="settings-row-description">When auto-layout aligns nodes to grid vertices</div>
            </div>
            <OptionGroup
              options={[
                { label: 'If Grid Enabled', value: 'if-enabled' },
                { label: 'Always', value: 'always' },
                { label: 'Never', value: 'never' }
              ]}
              value={gridSnapMode || 'if-enabled'}
              onChange={(v) => useGraphStore.getState().setGridSnapMode?.(v)}
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
                { label: 'Lombardi', value: 'lombardi' },
                { label: 'Manhattan', value: 'manhattan' },
                { label: 'Clean', value: 'clean' }
              ]}
              value={routingStyle || 'straight'}
              onChange={(v) => useGraphStore.getState().setRoutingStyle?.(v)}
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
          <div className="settings-row">
            <div className="settings-row-label">Label Color</div>
            <OptionGroup
              options={[
                { label: 'Always Light', value: 'light' },
                { label: 'Connection Color', value: 'connection' },
                { label: 'Theme', value: 'theme' }
              ]}
              value={connectionLabelColorMode}
              onChange={(v) => useGraphStore.getState().setConnectionLabelColorMode?.(v)}
            />
          </div>
          <div className="settings-row settings-row--attached">
            <div className="settings-row-label">Label Ring</div>
            <Toggle
              checked={!!connectionLabelOuterRing}
              onChange={() => useGraphStore.getState().toggleConnectionLabelOuterRing?.()}
            />
          </div>
          <div className="settings-slider-row">
            <MaroonSlider
              ariaLabel="Label Ring Width"
              value={connectionLabelRingWidth}
              min={CONNECTION_LABEL_RING_WIDTH_MIN}
              max={CONNECTION_LABEL_RING_WIDTH_MAX}
              step={0.05}
              suffix="x"
              disabled={!connectionLabelOuterRing}
              onChange={(v) => useGraphStore.getState().setConnectionLabelRingWidth?.(v)}
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              Truncate Long Labels
              <div className="settings-row-description">Ends a name too long for its connection in an ellipsis instead of letting it overhang the nodes</div>
            </div>
            <Toggle
              checked={!!connectionLabelTruncate}
              disabled={!showConnectionNames}
              onChange={() => useGraphStore.getState().toggleConnectionLabelTruncate?.()}
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              Fade Labels While Moving
              <div className="settings-row-description">Hides connection labels while panning or zooming, where they cost the most to draw</div>
            </div>
            <OptionGroup
              options={[
                { label: 'Off', value: 'off' },
                { label: 'Large Webs', value: 'large' },
                { label: 'Always', value: 'always' }
              ]}
              value={connectionLabelMoveFade}
              onChange={(v) => useGraphStore.getState().setConnectionLabelMoveFade?.(v)}
            />
          </div>
          <div className="settings-slider-row">
            <MaroonSlider
              label="Label Size"
              value={connectionLabelSize}
              min={0.5}
              max={2.0}
              step={0.05}
              suffix="x"
              disabled={!showConnectionNames}
              onChange={(v) => useGraphStore.getState().setConnectionLabelSize?.(v)}
            />
          </div>
          <div className="settings-slider-row">
            <MaroonSlider
              label="Connection Width"
              value={textSettings?.connectionWidth ?? 1.0}
              min={0.25}
              max={4.0}
              step={0.05}
              suffix="x"
              onChange={(v) => useGraphStore.getState().setConnectionWidth?.(v)}
            />
          </div>
          <div className="settings-slider-row">
            <MaroonSlider
              label="Multi Connection Curve"
              value={multiConnectionCurve}
              min={0}
              max={3.0}
              step={0.05}
              suffix="x"
              onChange={(v) => useGraphStore.getState().setMultiConnectionCurve?.(v)}
            />
          </div>
          {routingStyle === 'lombardi' && (
            <div className="settings-slider-row">
              <MaroonSlider
                label="Arc Curvature"
                value={lombardiCurvature}
                min={0}
                max={2}
                step={0.05}
                suffix="x"
                onChange={(v) => useGraphStore.getState().setLombardiCurvature?.(v)}
              />
            </div>
          )}
          {routingStyle === 'manhattan' && (
            <div className="settings-row">
              <div className="settings-row-label">
                Bends
                <div className="settings-row-description">How many corners a routed connection may turn</div>
              </div>
              <OptionGroup
                options={[
                  { label: 'Auto', value: 'auto' },
                  { label: 'One', value: 'one' },
                  { label: 'Two', value: 'two' }
                ]}
                value={manhattanBends}
                onChange={(v) => useGraphStore.getState().setManhattanBends?.(v)}
              />
            </div>
          )}
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
      title: 'Input',
      content: (
        <div>
          <div className="settings-section-subtitle">Touch</div>
          <div className="settings-slider-row">
            <MaroonSlider
              label="Zoom Sensitivity"
              value={touchSettings?.zoomSensitivity ?? 0.7}
              min={0.1}
              max={1.0}
              step={0.05}
              onChange={(v) => useGraphStore.getState().setTouchZoomSensitivity?.(v)}
              suffix=""
            />
          </div>
          <div className="settings-slider-row">
            <MaroonSlider
              label="Pan Sensitivity"
              value={touchSettings?.panSensitivity ?? 0.5}
              min={0.1}
              max={1.0}
              step={0.05}
              onChange={(v) => useGraphStore.getState().setTouchPanSensitivity?.(v)}
              suffix=""
            />
          </div>
          {/* Zoom before pan, same as the Trackpad section below. The store
              names are older than these labels: the touch zoom glide is
              `pinchGlide*` and the touch pan glide is the unqualified
              `glide*`. */}
          <div className="settings-row settings-row--attached">
            <div className="settings-row-label">
              Zoom Glide
              <div className="settings-row-description">Keep zooming with momentum after you release a two-finger pinch</div>
            </div>
            <Toggle
              checked={!!touchPinchGlideEnabled}
              onChange={() => useGraphStore.getState().toggleTouchPinchGlide?.()}
            />
          </div>
          <div className="settings-slider-row">
            <MaroonSlider
              value={touchPinchGlideStrength ?? 0.5}
              min={0.1}
              max={1.0}
              step={0.05}
              onChange={(v) => useGraphStore.getState().setTouchPinchGlideStrength?.(v)}
              disabled={!touchPinchGlideEnabled}
              suffix=""
            />
          </div>
          <div className="settings-row settings-row--attached">
            <div className="settings-row-label">
              Pan Glide
              <div className="settings-row-description">Keep panning with momentum after you flick and lift your finger</div>
            </div>
            <Toggle
              checked={!!touchGlideEnabled}
              onChange={() => useGraphStore.getState().toggleTouchGlide?.()}
            />
          </div>
          <div className="settings-slider-row">
            <MaroonSlider
              value={touchGlideStrength ?? 0.5}
              min={0.1}
              max={1.0}
              step={0.05}
              onChange={(v) => useGraphStore.getState().setTouchGlideStrength?.(v)}
              disabled={!touchGlideEnabled}
              suffix=""
            />
          </div>

          <hr className="settings-section-divider" />

          <div className="settings-section-subtitle">Trackpad</div>
          <div className="settings-slider-row">
            <MaroonSlider
              label="Zoom Sensitivity"
              value={trackpadZoomSensitivity ?? 0.5}
              min={0.1}
              max={1.0}
              step={0.05}
              onChange={(v) => useGraphStore.getState().setTrackpadZoomSensitivity?.(v)}
              suffix=""
            />
          </div>
          <div className="settings-slider-row">
            <MaroonSlider
              label="Pan Sensitivity"
              value={trackpadPanSensitivity ?? 0.5}
              min={0.1}
              max={1.0}
              step={0.05}
              onChange={(v) => useGraphStore.getState().setTrackpadPanSensitivity?.(v)}
              suffix=""
            />
          </div>
          <div className="settings-row settings-row--attached">
            <div className="settings-row-label">
              Zoom Glide
              <div className="settings-row-description">Keep zooming with momentum after you stop a trackpad pinch</div>
            </div>
            <Toggle
              checked={!!trackpadZoomGlideEnabled}
              onChange={() => useGraphStore.getState().toggleTrackpadZoomGlide?.()}
            />
          </div>
          <div className="settings-slider-row">
            <MaroonSlider
              value={trackpadZoomGlideStrength ?? 0.5}
              min={0.1}
              max={1.0}
              step={0.05}
              onChange={(v) => useGraphStore.getState().setTrackpadZoomGlideStrength?.(v)}
              disabled={!trackpadZoomGlideEnabled}
              suffix=""
            />
          </div>
          <div className="settings-row settings-row--attached">
            <div className="settings-row-label">
              Pan Glide
              <div className="settings-row-description">Keep panning with momentum after you lift a two-finger swipe</div>
            </div>
            <Toggle
              checked={!!trackpadPanGlideEnabled}
              onChange={() => useGraphStore.getState().toggleTrackpadPanGlide?.()}
            />
          </div>
          <div className="settings-slider-row">
            <MaroonSlider
              value={trackpadPanGlideStrength ?? TRACKPAD_PAN_GLIDE_STRENGTH_DEFAULT}
              min={0.1}
              max={1.0}
              step={0.05}
              onChange={(v) => useGraphStore.getState().setTrackpadPanGlideStrength?.(v)}
              disabled={!trackpadPanGlideEnabled}
              suffix=""
            />
          </div>

          <hr className="settings-section-divider" />

          <div className="settings-section-subtitle">Mouse</div>
          <div className="settings-row settings-row--attached">
            <div className="settings-row-label">
              Pan Glide
              <div className="settings-row-description">Keep panning with momentum after you release a click-drag pan</div>
            </div>
            <Toggle
              checked={!!mouseGlideEnabled}
              onChange={() => useGraphStore.getState().toggleMouseGlide?.()}
            />
          </div>
          <div className="settings-slider-row">
            <MaroonSlider
              value={mouseGlideStrength ?? 0.5}
              min={0.1}
              max={1.0}
              step={0.05}
              onChange={(v) => useGraphStore.getState().setMouseGlideStrength?.(v)}
              disabled={!mouseGlideEnabled}
              suffix=""
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              Hold Middle Click to Zoom
              <div className="settings-row-description">Press and drag with the middle mouse button to zoom in and out</div>
            </div>
            <Toggle
              checked={!!middleMouseZoomEnabled}
              onChange={() => useGraphStore.getState().toggleMiddleMouseZoom?.()}
            />
          </div>
          <hr className="settings-section-divider" />

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

          <div className="settings-section-subtitle">Dragging</div>
          <div className="settings-slider-row">
            <MaroonSlider
              label="Lift Delay"
              value={nodeLiftDelay ?? 250}
              min={50}
              max={600}
              step={25}
              suffix="ms"
              onChange={(v) => useGraphStore.getState().setNodeLiftDelay?.(v)}
            />
          </div>
          <div className="settings-row-description" style={{ marginTop: '-8px', marginBottom: '12px', fontSize: '0.78em', color: 'var(--text-secondary, #888)' }}>
            How long to hold before a node is picked up for dragging
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              Edge Pan While Dragging Nodes
              <div className="settings-row-description">Automatically pan the canvas when the pointer reaches the viewport edge while moving a Thing. Applies to mouse and touch.</div>
            </div>
            <Toggle
              checked={!!nodeDragEdgePanEnabled}
              onChange={() => useGraphStore.getState().toggleNodeDragEdgePan?.()}
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              Edge Pan While Drawing Connections
              <div className="settings-row-description">Automatically pan the canvas when the pointer reaches the viewport edge while drawing a connection. Applies to mouse and touch.</div>
            </div>
            <Toggle
              checked={!!connectionDrawEdgePanEnabled}
              onChange={() => useGraphStore.getState().toggleConnectionDrawEdgePan?.()}
            />
          </div>

          <hr className="settings-section-divider" />

          {/* Both zoom behaviours are a toggle over its own amount, laid out the
              way the glide settings above are: an attached header row, then the
              bar it governs. One of the two used to have no amount at all. */}
          <div className="settings-section-subtitle">Zoom</div>
          <div className="settings-row settings-row--attached">
            <div className="settings-row-label">
              Zoom on Drag
              <div className="settings-row-description">Zoom out when dragging a node</div>
            </div>
            <Toggle
              checked={!!dragZoomEnabled}
              onChange={() => useGraphStore.getState().toggleDragZoomEnabled?.()}
            />
          </div>
          <div className="settings-slider-row">
            <MaroonSlider
              value={dragZoomAmount ?? 0.45}
              min={0.0}
              max={0.9}
              step={0.05}
              onChange={(v) => useGraphStore.getState().setDragZoomAmount?.(v)}
              disabled={!dragZoomEnabled}
              suffix=""
            />
          </div>
          <div className="settings-row settings-row--attached">
            <div className="settings-row-label">
              Zoom on Select
              <div className="settings-row-description">Zoom to frame a single Thing when you select it. Ignored when multiple Things are selected.</div>
            </div>
            <Toggle
              checked={!!focusOnSelectEnabled}
              onChange={() => useGraphStore.getState().toggleFocusOnSelectEnabled?.()}
            />
          </div>
          <div className="settings-slider-row">
            <MaroonSlider
              value={focusOnSelectZoomAmount ?? 1.0}
              min={0.5}
              max={1.5}
              step={0.05}
              suffix="x"
              disabled={!focusOnSelectEnabled}
              onChange={(v) => useGraphStore.getState().setFocusOnSelectZoomAmount?.(v)}
            />
          </div>
        </div>
      )
    },
    ai: {
      title: 'AI & API Keys',
      content: <AISection />
    },
    about: {
      title: 'About',
      content: (
        <div>
          <div style={{ marginBottom: '16px' }}>
            <span style={{
              fontSize: '1.4rem',
              fontWeight: 'bold',
              color: theme.canvas.brandText
            }}>
              Redstring
            </span>
            {/* Also the way in to the Debug page, and the only way in on a
                phone. Styled as plain text — it is meant to be found, not
                advertised. */}
            <span
              role="button"
              tabIndex={0}
              onClick={registerAboutTap}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); registerAboutTap(); } }}
              style={{
                fontSize: '0.75rem',
                color: theme.canvas.textSecondary,
                marginLeft: '10px',
                cursor: 'default',
                userSelect: 'none',
                WebkitTapHighlightColor: 'transparent'
              }}
            >
              v{import.meta.env.VITE_APP_VERSION}
            </span>
            {!debugUnlocked && aboutTaps > 0 && tapsRemaining <= 3 && (
              <div style={{ marginTop: '6px', fontSize: '0.72rem', color: theme.canvas.textSecondary }}>
                {tapsRemaining} more to show debug settings
              </div>
            )}
            {debugUnlocked && (
              <div style={{ marginTop: '6px', fontSize: '0.72rem', color: theme.canvas.textSecondary }}>
                Debug settings are showing at the bottom of the list.
              </div>
            )}
          </div>
          <div style={{
            fontSize: '0.8rem',
            color: theme.canvas.textSecondary,
            lineHeight: '1.7',
            marginBottom: '16px'
          }}>
            A semantic knowledge graph that bridges human cognition and machine intelligence through visual node-based interfaces, W3C semantic web standards, and AI-powered knowledge discovery.
          </div>
          <ul style={{
            fontSize: '0.78rem',
            color: theme.canvas.textSecondary,
            lineHeight: '1.8',
            margin: 0,
            paddingLeft: '18px',
            listStyleType: 'disc'
          }}>
            <li><strong style={{ color: theme.canvas.textPrimary }}>Visual Knowledge Graphs</strong> — hierarchical, expandable nodes with contextual definitions</li>
            <li><strong style={{ color: theme.canvas.textPrimary }}>Semantic Web</strong> — W3C compliant with RDF, OWL, and JSON-LD; integrates Wikidata, DBpedia, and Wikipedia</li>
            <li><strong style={{ color: theme.canvas.textPrimary }}>Local-First</strong> — your data lives on your machine; Git and cloud sync are opt-in</li>
            <li><strong style={{ color: theme.canvas.textPrimary }}>Git Federation</strong> — real-time sync with hot-swappable providers and multi-provider redundancy</li>
            <li><strong style={{ color: theme.canvas.textPrimary }}>AI-Native</strong> — first-class AI integration via MCP and HTTP tool framework</li>
          </ul>
          <div style={{
            marginTop: '20px',
            paddingTop: '14px',
            borderTop: `1px solid ${theme.canvas.border}`,
            fontSize: '0.72rem',
            color: theme.canvas.textSecondary,
            lineHeight: '1.6'
          }}>
            Everything is connected. Most things can be generalized as a community of components and relations. Redstring makes these connections visible, explorable, and shareable.
          </div>
        </div>
      )
    }
  };

  // Last in the list, and only once it has been asked for.
  if (debugUnlocked) {
    sections.debug = {
      title: 'Debug',
      content: <DebugSection onCloseSettings={onClose} onRelock={relockDebug} />
    };
  }

  sectionsRef.current = sections;

  // A relock drops the section out from under the page rendering it, and the
  // event listener above can be handed any string at all.
  const activeSectionData = sections[activeSection] || sections.display;

  const modalContent = (
    <div
      className={theme.darkMode ? 'modal-dark' : ''}
      style={{
        display: 'flex',
        height: '100%',
        fontFamily: "'EmOne', sans-serif",
        fontSize: isCompactLayout ? '0.85rem' : '0.9rem'
      }}
    >
      {/* Close button */}
      <PanelIconButton
        icon={X}
        size={18}
        title="Close"
        onClick={onClose}
        style={{
          position: 'absolute',
          top: isCompactLayout ? '12px' : '16px',
          right: isCompactLayout ? '32px' : '40px',
          zIndex: 10,
          touchAction: 'manipulation'
        }}
      />

      {/* Sidebar Navigation */}
      {!isCompactLayout && (
        <div
          className="settings-modal-sidebar modal-scroll"
          style={{
            width: '180px',
            borderRight: `1px solid ${theme.canvas.border}`,
            padding: '20px 12px',
            overflowY: 'auto',
            flexShrink: 0
          }}
        >
          <h3 className="modal-nav-heading">
            Settings
          </h3>
          {Object.keys(sections).map((key) => (
            <button
              key={key}
              type="button"
              className={`modal-nav-item ${activeSection === key ? 'active' : ''}`}
              aria-current={activeSection === key ? 'true' : undefined}
              onClick={() => {
                // Any other destination is the user going somewhere, which
                // means the run of About taps is over.
                if (key === 'about') registerAboutTap(); else setAboutTaps(0);
                setActiveSection(key);
              }}
            >
              {sectionIcons[key]}
              {sections[key].title}
            </button>
          ))}
        </div>
      )}

      {/* Main Content Area */}
      <div
        className="settings-modal-content modal-scroll"
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
              className="modal-input"
              aria-label="Settings section"
              value={activeSection}
              onChange={(e) => {
                if (e.target.value !== 'about') setAboutTaps(0);
                setActiveSection(e.target.value);
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
          {activeSectionData.title}
        </h2>

        <div style={{
          lineHeight: '1.6',
          color: theme.canvas.textSecondary
        }}>
          {activeSectionData.content}
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
