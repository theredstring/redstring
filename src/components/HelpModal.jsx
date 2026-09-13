import React, { useState } from 'react';
import CanvasModal from './CanvasModal';
import { X } from 'lucide-react';
import { useTheme } from '../hooks/useTheme.js';
import PanelIconButton from './shared/PanelIconButton.jsx';
import './ModalChrome.css';

/**
 * Help Modal
 * Comprehensive guide for using Redstring
 */
const HelpModal = ({ isVisible, onClose }) => {
  const theme = useTheme();
  const [activeSection, setActiveSection] = useState('basics');
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

  const isCompactLayout = viewportSize.width <= 768;
  const modalWidth = isCompactLayout
    ? Math.min(Math.max(viewportSize.width - 24, 320), 540)
    : 700;
  const modalHeight = isCompactLayout
    ? Math.min(Math.max(viewportSize.height * 0.85, 400), 600)
    : 600;

  // The panel's brand-on-surface token, not a pair of hand-picked reds. In
  // light mode it is the brand maroon; in dark it lifts to the warm rose the
  // maroon can't survive as at #2E2A2A.
  const headingColor = theme.canvas.brandText;

  const sections = {
    basics: {
      title: 'Basic Controls',
      content: (
        <div>
          <h3 style={{ color: headingColor, marginTop: 0 }}>Working with Things</h3>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>Move a Thing:</strong> Click and hold, then drag to reposition</li>
            <li><strong>Create a Connection:</strong> Click and drag from one Thing to another</li>
            <li><strong>Add meaning to a Connection:</strong> Click on the connection line to label it with a Thing</li>
            <li><strong>Make an arrow:</strong> Click on the dots at the ends of a connection</li>
            <li><strong>Open Thing in panel:</strong> Click on a Thing, then click "Open in Panel" or just double-click the Thing</li>
            <li><strong>Access Thing options:</strong> Click on a Thing to see the pie menu with all options</li>
          </ul>

          <h3 style={{ color: headingColor }}>Pie Menu Options</h3>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>Decompose (package icon):</strong> Break down a Thing into its components. In decomposed view, click the "Open Package" button to convert the Thing into a Thing-Group</li>
            <li><strong>Abstraction (stack icon):</strong> Change the level of specificity (more general ↔ more specific)</li>
            <li><strong>Edit:</strong> Change color, name, and description</li>
            <li><strong>Delete:</strong> Remove the Thing from this Web</li>
            <li><strong>Add to Group:</strong> Organize Things into collections</li>
          </ul>

          <h3 style={{ color: headingColor }}>Keyboard Controls</h3>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>WASD:</strong> Pan the canvas (up/left/down/right)</li>
            <li><strong>Shift:</strong> Zoom in</li>
            <li><strong>Space:</strong> Zoom out</li>
            <li><strong>Tab (tap):</strong> Hide/show panels</li>
            <li><strong>Tab (hold) + Q/A/← or E/D/→:</strong> Scrub through open Webs</li>
            <li><strong>1:</strong> Toggle left panel</li>
            <li><strong>2:</strong> Toggle right panel</li>
            <li><strong>3:</strong> Toggle bottom bar</li>
          </ul>

          <h3 style={{ color: headingColor }}>Mouse &amp; Trackpad</h3>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>Mouse Wheel / Two-Finger Scroll:</strong> Pan the canvas</li>
            <li><strong>Alt/Option + Wheel:</strong> Pan horizontally</li>
            <li><strong>Ctrl/Cmd + Wheel:</strong> Zoom toward cursor</li>
            <li><strong>Trackpad Pinch:</strong> Zoom toward cursor</li>
            <li><strong>Click and drag on empty space:</strong> Pan the canvas</li>
          </ul>

          <h3 style={{ color: headingColor }}>Game Controller</h3>
          <p>
            Plug in a controller and start using it — the canvas switches over on its own, and hands
            back to the mouse the moment you move it. See the <strong>Controller</strong> topic for the
            full button map.
          </p>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>Left Stick:</strong> Pan the canvas under the crosshair</li>
            <li><strong>Right Stick (up/down):</strong> Zoom</li>
            <li><strong>A:</strong> Select whatever the crosshair is on, and open its menu</li>
            <li><strong>B:</strong> Back out — deselect, close a menu</li>
            <li><strong>Right Trigger (hold):</strong> Pick up and carry a Thing</li>
            <li><strong>Left Trigger (hold):</strong> Draw a connection from a Thing</li>
          </ul>
        </div>
      )
    },
    navigation: {
      title: 'Navigation',
      content: (
        <div>
          <h3 style={{ color: headingColor, marginTop: 0 }}>Moving Around the Canvas</h3>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>Pan:</strong> Mouse wheel, two-finger trackpad scroll, or click-and-drag on empty space. Hold Alt/Option to pan horizontally</li>
            <li><strong>Zoom:</strong> Ctrl/Cmd + Wheel, trackpad pinch, or Shift/Space keyboard</li>
            <li><strong>Go back:</strong> Use the breadcrumb navigation at the top to return to parent Webs</li>
          </ul>

          <h3 style={{ color: headingColor }}>Keyboard Navigation</h3>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>WASD:</strong> Pan the canvas (up/left/down/right)</li>
            <li><strong>Shift:</strong> Zoom in</li>
            <li><strong>Space:</strong> Zoom out</li>
            <li><strong>Tab (tap):</strong> Hide/show panels</li>
            <li><strong>Tab (hold) + Q/A/← or E/D/→:</strong> Scrub through open Webs</li>
            <li><strong>1:</strong> Toggle left panel</li>
            <li><strong>2:</strong> Toggle right panel</li>
            <li><strong>3:</strong> Toggle bottom bar</li>
          </ul>

          <h3 style={{ color: headingColor }}>Mouse &amp; Trackpad</h3>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>Mouse Wheel / Two-Finger Scroll:</strong> Pan the canvas</li>
            <li><strong>Alt/Option + Wheel:</strong> Pan horizontally</li>
            <li><strong>Ctrl/Cmd + Wheel:</strong> Zoom toward cursor</li>
            <li><strong>Trackpad Pinch:</strong> Zoom toward cursor</li>
            <li><strong>Click and drag on empty space:</strong> Pan the canvas</li>
          </ul>

          <h3 style={{ color: headingColor }}>Controller Navigation</h3>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>Left Stick:</strong> Pan — the canvas moves under a crosshair fixed to the center of the screen</li>
            <li><strong>Right Stick (up/down):</strong> Zoom toward the crosshair</li>
            <li><strong>D-pad:</strong> Move through the header and panels, without taking the sticks off the canvas</li>
            <li><strong>Bumpers (LB/RB):</strong> Previous/next Web, or previous/next tab when a panel is open</li>
            <li><strong>Stick Click (L3/R3):</strong> Open or close the panel on that side</li>
          </ul>

          <h3 style={{ color: headingColor }}>Interface Panels</h3>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>Left Panel (Globe icon):</strong> Universe management and GitHub sync</li>
            <li><strong>Right Panel:</strong> Thing details, properties, and editing. Opens when you double-click a Thing</li>
            <li><strong>Bottom Panel:</strong> Type selector and Web switcher for navigating between different Webs</li>
            <li><strong>Top Menu (three lines):</strong> File operations, view settings, and connection routing options</li>
          </ul>
        </div>
      )
    },
    controller: {
      title: 'Controller',
      content: (
        <div>
          <h3 style={{ color: headingColor, marginTop: 0 }}>How Controller Mode Works</h3>
          <p>
            Nothing turns it on: controller mode engages the moment you actually use a connected pad,
            and hands back to the mouse as soon as you move the mouse or press a key.
          </p>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>The crosshair is the cursor.</strong> It stays pinned to the center of the screen and the canvas moves underneath it, so "the Thing under the pointer" becomes "the Thing under the center"</li>
            <li><strong>Auto-aim:</strong> let the stick rest with something under the crosshair and the view drifts it to center</li>
            <li><strong>Button names below are the Xbox ones</strong> — A bottom, B right, X left, Y top. Positions are identical on PlayStation and Switch Pro pads; only the printed labels differ</li>
            <li><strong>Settings → Input → Controller</strong> holds sensitivity, stick deadzone, crosshair size, and the panel-resize binding</li>
          </ul>

          <h3 style={{ color: headingColor }}>On the Canvas</h3>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>Left Stick:</strong> Pan</li>
            <li><strong>Right Stick (up/down):</strong> Zoom toward the crosshair</li>
            <li><strong>A:</strong> Act on whatever is under the crosshair — select a Thing and open its pie menu, select a connection, toggle an arrow on a connection's endpoint dot, select a Group, or drop a plus sign on empty canvas</li>
            <li><strong>B:</strong> Back out — deselect, close the menu, dismiss the plus sign</li>
            <li><strong>X:</strong> Open the Thing under the crosshair in the right panel</li>
            <li><strong>Y:</strong> Expand the Thing under the crosshair into its own Web</li>
            <li><strong>Right Trigger (hold):</strong> Pick up the Thing (or Group title) under the crosshair, pan to place it, release to drop</li>
            <li><strong>Left Trigger (hold) on a Thing:</strong> Draw a connection — pan until the target sits under the crosshair, then release</li>
            <li><strong>Left Trigger (hold) on empty canvas:</strong> Draw a selection box. Catching anything raises the bottom panel, where "Group Selection" lives</li>
            <li><strong>Left Trigger (tap) on empty canvas:</strong> Open the canvas menu — the same one right-click gives. The trigger again, or B, closes it</li>
          </ul>

          <h3 style={{ color: headingColor }}>Menus</h3>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>Pie menu:</strong> With a Thing selected, the left stick aims the ring by direction and <strong>A</strong> runs the focused option</li>
            <li><strong>More than one page:</strong> LB or Left Trigger for the previous page, RB or Right Trigger for the next</li>
            <li><strong>Connection menu:</strong> The left stick moves to whichever bubble lies in the direction you push, diagonals included</li>
            <li><strong>Bottom panel</strong> (a selected Group, or a box selection): the left stick steps the row, <strong>A</strong> activates</li>
            <li><strong>Selectors and grids</strong> (naming a Thing, Swap): stick or d-pad moves, <strong>A</strong> confirms, <strong>Y</strong> opens the color picker, <strong>B</strong> backs out one layer at a time</li>
            <li><strong>On a focused slider:</strong> the stick sweeps the value, the d-pad steps it in notches</li>
            <li><strong>Semantic orbit:</strong> the left stick aims, <strong>A</strong> materializes the focused item, <strong>B</strong> closes</li>
            <li><strong>Start:</strong> Open the Redstring menu. <strong>Select/Back:</strong> the header's action buttons. B, Start or Select leaves either</li>
          </ul>

          <h3 style={{ color: headingColor }}>Panels &amp; Tabs</h3>
          <p>
            The d-pad works the interface while the sticks keep flying the canvas — they are different
            hands on different surfaces, so neither waits on the other.
          </p>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>D-pad Up:</strong> Into the Web tabs in the header. <strong>A</strong> switches to the focused tab; <strong>LB/RB</strong> drag that tab along the strip to reorder it</li>
            <li><strong>D-pad Left/Right:</strong> Into the open panel, or across to the other one</li>
            <li><strong>D-pad Down (on canvas):</strong> Cycle the bottom bar through Connection, Node, Component and closed</li>
            <li><strong>A</strong> activates whatever the d-pad is standing on; <strong>B</strong> gives the d-pad's place back to the canvas</li>
            <li><strong>Stick Click (L3/R3):</strong> Open or close the panel on that side</li>
            <li><strong>LB/RB:</strong> Previous/next tab in the open panel; with no panel open, previous/next Web</li>
            <li><strong>Resize a panel:</strong> Hold that side's stick click and push the stick sideways. Settings → Input → Controller can move the resize onto the bumpers instead, which leaves the stick free for the whole gesture</li>
          </ul>
        </div>
      )
    },
    universes: {
      title: 'Universes',
      content: (
        <div>
          <h3 style={{ color: headingColor, marginTop: 0 }}>What are Universes?</h3>
          <p>
            <strong>Universes</strong> are complete workspaces that contain all your Things and Webs.
            Think of them as different projects or knowledge domains.
          </p>

          <h3 style={{ color: headingColor }}>Storage Options</h3>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>GitHub (Recommended):</strong> Cloud sync, version history, collaboration</li>
            <li><strong>Local Files:</strong> Store .redstring files on your device</li>
            <li><strong>Browser Cache:</strong> Temporary storage (not persistent)</li>
          </ul>

          <h3 style={{ color: headingColor }}>Managing Universes</h3>
          <p>
            Click the <strong>Globe icon</strong> in the left panel to:
          </p>
          <ul style={{ lineHeight: '1.8' }}>
            <li>Create new Universes</li>
            <li>Switch between Universes</li>
            <li>Connect to GitHub for cloud sync</li>
            <li>Manage local files</li>
            <li>View sync status</li>
          </ul>
        </div>
      )
    },
    concepts: {
      title: 'Key Concepts',
      content: (
        <div>
          <h3 style={{ color: headingColor, marginTop: 0 }}>Things (aka "Nodes")</h3>
          <p>
            <strong>Things</strong> are individual concepts, entities, or ideas. Each Thing can:
          </p>
          <ul style={{ lineHeight: '1.8' }}>
            <li>Have a name, color, and description</li>
            <li>Connect to other Things</li>
            <li>Contain its own Web (definition)</li>
            <li>Appear in multiple Webs</li>
          </ul>

          <h3 style={{ color: headingColor }}>Webs (aka "Networks")</h3>
          <p>
            <strong>Webs</strong> are collections of Things and their connections. They represent:
          </p>
          <ul style={{ lineHeight: '1.8' }}>
            <li>Relationships between concepts</li>
            <li>Definitions of Things</li>
            <li>Contexts and domains</li>
            <li>Hierarchical structures</li>
          </ul>

          <h3 style={{ color: headingColor }}>Recursive Structure</h3>
          <p>
            Things can contain Webs, and those Webs can contain Things that themselves contain Webs.
            This allows you to organize knowledge at any level of detail.
          </p>
        </div>
      )
    },
    advanced: {
      title: 'Advanced Features',
      content: (
        <div>
          <h3 style={{ color: headingColor, marginTop: 0 }}>GitHub Integration</h3>
          <p>Connect your GitHub account for:</p>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>Automatic cloud backup</strong> of your Universes</li>
            <li><strong>Version history</strong> with Git commits</li>
            <li><strong>Collaboration</strong> across devices</li>
            <li><strong>Repository management</strong> directly in Redstring</li>
          </ul>

          <h3 style={{ color: headingColor }}>Semantic Web Integration</h3>
          <p>Import knowledge from external sources like:</p>
          <ul style={{ lineHeight: '1.8' }}>
            <li>Wikidata</li>
            <li>DBpedia</li>
            <li>Other SPARQL endpoints</li>
          </ul>

          <h3 style={{ color: headingColor }}>Connection Routing</h3>
          <p>Customize how connections are displayed:</p>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>Straight:</strong> Direct lines between Things</li>
            <li><strong>Manhattan:</strong> Orthogonal routing with right-angle bends</li>
            <li><strong>Clean:</strong> Smooth curved paths with adjustable spacing</li>
          </ul>
          <p>Access these options in the top menu under Connections.</p>
        </div>
      )
    },
    troubleshooting: {
      title: 'Troubleshooting',
      content: (
        <div>
          <h3 style={{ color: headingColor, marginTop: 0 }}>Common Issues</h3>

          <h4>Canvas not responding</h4>
          <ul style={{ lineHeight: '1.8' }}>
            <li>Refresh the page</li>
            <li>Check that JavaScript is enabled</li>
            <li>Try a different browser</li>
          </ul>

          <h4>Changes not saving</h4>
          <ul style={{ lineHeight: '1.8' }}>
            <li>Check your GitHub connection status (globe icon)</li>
            <li>Ensure you have write permissions to the repository</li>
            <li>Try a manual save (Ctrl/Cmd + S)</li>
            <li>Check browser console for errors</li>
          </ul>

          <h4>Slow performance</h4>
          <ul style={{ lineHeight: '1.8' }}>
            <li>Use abstraction to hide complexity</li>
            <li>Break large Webs into smaller sub-Webs</li>
            <li>Close unused browser tabs</li>
            <li>Clear browser cache</li>
          </ul>
        </div>
      )
    }
  };

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
          className="help-modal-sidebar modal-scroll"
          style={{
            width: '160px',
            borderRight: `1px solid ${theme.canvas.border}`,
            padding: '20px 12px',
            overflowY: 'auto',
            flexShrink: 0
          }}
        >
          <h3 className="modal-nav-heading">
            Topics
          </h3>
          {Object.keys(sections).map((key) => (
            <button
              key={key}
              type="button"
              className={`modal-nav-item ${activeSection === key ? 'active' : ''}`}
              aria-current={activeSection === key ? 'true' : undefined}
              onClick={() => setActiveSection(key)}
            >
              {sections[key].title}
            </button>
          ))}
        </div>
      )}

      {/* Main Content Area */}
      <div
        className="help-modal-content modal-scroll"
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
              aria-label="Help topic"
              value={activeSection}
              onChange={(e) => setActiveSection(e.target.value)}
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

export default HelpModal;
