import React, { useState } from 'react';
import CanvasModal from './CanvasModal';
import { ChevronRight } from 'lucide-react';

/**
 * Help Modal
 * Comprehensive guide for using Redstring
 */
const HelpModal = ({ isVisible, onClose }) => {
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

  const sections = {
    basics: {
      title: 'Basic Controls',
      content: (
        <div>
          <h3 style={{ color: '#8B0000', marginTop: 0 }}>Working with Things</h3>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>Move a Thing:</strong> Click and hold, then drag to reposition</li>
            <li><strong>Create a Connection:</strong> Click and drag from one Thing to another</li>
            <li><strong>Add meaning to a Connection:</strong> Click on the connection line to label it with a Thing</li>
            <li><strong>Make an arrow:</strong> Click on the dots at the ends of a connection</li>
            <li><strong>Open Thing in panel:</strong> Click on a Thing, then click "Open in Panel" or just double-click the Thing</li>
            <li><strong>Access Thing options:</strong> Click on a Thing to see the pie menu with all options</li>
          </ul>

          <h3 style={{ color: '#8B0000' }}>Pie Menu Options</h3>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>Decompose (package icon):</strong> Break down a Thing into its components. In decomposed view, click the "Open Package" button to convert the Thing into a Thing-Group</li>
            <li><strong>Abstraction (stack icon):</strong> Change the level of specificity (more general ↔ more specific)</li>
            <li><strong>Edit:</strong> Change color, name, and description</li>
            <li><strong>Delete:</strong> Remove the Thing from this Web</li>
            <li><strong>Add to Group:</strong> Organize Things into collections</li>
          </ul>

          <h3 style={{ color: '#8B0000' }}>Keyboard Controls</h3>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>W/A/S/D:</strong> Pan the canvas (up/left/down/right)</li>
            <li><strong>Shift:</strong> Zoom in</li>
            <li><strong>Space:</strong> Zoom out</li>
            <li><strong>1:</strong> Toggle left panel</li>
            <li><strong>2:</strong> Toggle right panel</li>
            <li><strong>3:</strong> Toggle bottom bar</li>
          </ul>
        </div>
      )
    },
    navigation: {
      title: 'Navigation',
      content: (
        <div>
          <h3 style={{ color: '#8B0000', marginTop: 0 }}>Moving Around the Canvas</h3>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>Pan (Mouse):</strong> Click and drag on empty space to move around</li>
            <li><strong>Pan (Trackpad):</strong> Two-finger drag to pan smoothly</li>
            <li><strong>Zoom (Mouse):</strong> Use mouse wheel to zoom in and out</li>
            <li><strong>Zoom (Trackpad):</strong> Pinch with two fingers to zoom</li>
            <li><strong>Go back:</strong> Use the breadcrumb navigation at the top to return to parent Webs</li>
          </ul>

          <h3 style={{ color: '#8B0000' }}>Interface Panels</h3>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>Left Panel (Globe icon):</strong> Universe management and GitHub sync</li>
            <li><strong>Right Panel:</strong> Thing details, properties, and editing. Opens when you double-click a Thing</li>
            <li><strong>Bottom Panel:</strong> Type selector and Web switcher for navigating between different Webs</li>
            <li><strong>Top Menu (three lines):</strong> File operations, view settings, and connection routing options</li>
          </ul>
        </div>
      )
    },
    universes: {
      title: 'Universes',
      content: (
        <div>
          <h3 style={{ color: '#8B0000', marginTop: 0 }}>What are Universes?</h3>
          <p>
            <strong>Universes</strong> are complete workspaces that contain all your Things and Webs. 
            Think of them as different projects or knowledge domains.
          </p>

          <h3 style={{ color: '#8B0000' }}>Storage Options</h3>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>GitHub (Recommended):</strong> Cloud sync, version history, collaboration</li>
            <li><strong>Local Files:</strong> Store .redstring files on your device</li>
            <li><strong>Browser Cache:</strong> Temporary storage (not persistent)</li>
          </ul>

          <h3 style={{ color: '#8B0000' }}>Managing Universes</h3>
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
          <h3 style={{ color: '#8B0000', marginTop: 0 }}>Things (aka "Nodes")</h3>
          <p>
            <strong>Things</strong> are individual concepts, entities, or ideas. Each Thing can:
          </p>
          <ul style={{ lineHeight: '1.8' }}>
            <li>Have a name, color, and description</li>
            <li>Connect to other Things</li>
            <li>Contain its own Web (definition)</li>
            <li>Appear in multiple Webs</li>
          </ul>

          <h3 style={{ color: '#8B0000' }}>Webs (aka "Networks")</h3>
          <p>
            <strong>Webs</strong> are collections of Things and their connections. They represent:
          </p>
          <ul style={{ lineHeight: '1.8' }}>
            <li>Relationships between concepts</li>
            <li>Definitions of Things</li>
            <li>Contexts and domains</li>
            <li>Hierarchical structures</li>
          </ul>

          <h3 style={{ color: '#8B0000' }}>Recursive Structure</h3>
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
          <h3 style={{ color: '#8B0000', marginTop: 0 }}>GitHub Integration</h3>
          <p>Connect your GitHub account for:</p>
          <ul style={{ lineHeight: '1.8' }}>
            <li><strong>Automatic cloud backup</strong> of your Universes</li>
            <li><strong>Version history</strong> with Git commits</li>
            <li><strong>Collaboration</strong> across devices</li>
            <li><strong>Repository management</strong> directly in Redstring</li>
          </ul>

          <h3 style={{ color: '#8B0000' }}>Semantic Web Integration</h3>
          <p>Import knowledge from external sources like:</p>
          <ul style={{ lineHeight: '1.8' }}>
            <li>Wikidata</li>
            <li>DBpedia</li>
            <li>Other SPARQL endpoints</li>
          </ul>

          <h3 style={{ color: '#8B0000' }}>Connection Routing</h3>
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
          <h3 style={{ color: '#8B0000', marginTop: 0 }}>Common Issues</h3>
          
          <h4>Canvas not responding</h4>
          <ul style={{ lineHeight: '1.8' }}>
            <li>Refresh the page</li>
            <li>Check that JavaScript is enabled</li>
            <li>Try a different browser</li>
          </ul>

          <h4>Changes not saving</h4>
          <ul style={{ lineHeight: '1.8' }}>
            <li>Check your GitHub connection status (🌐 icon)</li>
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

          <h4>Mobile/Tablet Notice</h4>
          <p style={{ 
            backgroundColor: '#fff3cd', 
            padding: '12px', 
            borderRadius: '6px',
            border: '1px solid #ffc107',
            color: '#856404'
          }}>
            <strong>Note:</strong> Redstring is currently optimized for desktop browsers. 
            Mobile and tablet support is incomplete in this version.
          </p>
        </div>
      )
    }
  };

  const modalContent = (
    <div style={{
      display: 'flex',
      height: '100%',
      fontFamily: "'EmOne', sans-serif",
      fontSize: isCompactLayout ? '0.85rem' : '0.9rem'
    }}>
      <style>
        {`
          .help-modal-sidebar::-webkit-scrollbar {
            width: 20px;
          }
          .help-modal-sidebar::-webkit-scrollbar-track {
            background: rgba(38, 0, 0, 0.05);
            border-radius: 4px;
          }
          .help-modal-sidebar::-webkit-scrollbar-thumb {
            background-color: rgba(38, 0, 0, 0.1);
            border-radius: 4px;
            border: 6px solid transparent;
            background-clip: padding-box;
          }
          .help-modal-sidebar:hover::-webkit-scrollbar-thumb {
            background-color: #260000;
            border-width: 4px;
          }
          .help-modal-sidebar {
            scrollbar-width: thin;
            scrollbar-color: rgba(38, 0, 0, 0.1) rgba(38, 0, 0, 0.05);
          }

          .help-modal-content::-webkit-scrollbar {
            width: 20px;
          }
          .help-modal-content::-webkit-scrollbar-track {
            background: rgba(38, 0, 0, 0.05);
            border-radius: 4px;
          }
          .help-modal-content::-webkit-scrollbar-thumb {
            background-color: rgba(38, 0, 0, 0.1);
            border-radius: 4px;
            border: 6px solid transparent;
            background-clip: padding-box;
          }
          .help-modal-content:hover::-webkit-scrollbar-thumb {
            background-color: #260000;
            border-width: 4px;
          }
          .help-modal-content {
            scrollbar-width: thin;
            scrollbar-color: rgba(38, 0, 0, 0.1) rgba(38, 0, 0, 0.05);
          }
        `}
      </style>

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
          color: '#666',
          cursor: 'pointer',
          padding: '6px',
          borderRadius: '4px',
          fontSize: '16px',
          fontWeight: 'bold',
          fontFamily: "'EmOne', sans-serif",
          zIndex: 10,
          touchAction: 'manipulation'
        }}
        onMouseEnter={(e) => e.currentTarget.style.color = '#260000'}
        onMouseLeave={(e) => e.currentTarget.style.color = '#666'}
      >
        ✕
      </button>

      {/* Sidebar Navigation */}
      {!isCompactLayout && (
        <div 
          className="help-modal-sidebar"
          style={{
            width: '160px',
            borderRight: '1px solid #260000',
            padding: '20px 12px',
            overflowY: 'auto',
            flexShrink: 0
          }}
        >
          <h3 style={{ 
            margin: '0 0 16px 0', 
            fontSize: '1.1rem',
            color: '#260000'
          }}>
            Topics
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
                backgroundColor: activeSection === key ? 'rgba(139, 0, 0, 0.1)' : 'transparent',
                color: activeSection === key ? '#8B0000' : '#333',
                fontWeight: activeSection === key ? 'bold' : 'normal',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                if (activeSection !== key) {
                  e.currentTarget.style.backgroundColor = 'rgba(139, 0, 0, 0.05)';
                }
              }}
              onMouseLeave={(e) => {
                if (activeSection !== key) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }
              }}
            >
              {sections[key].title}
            </div>
          ))}
        </div>
      )}

      {/* Main Content Area */}
      <div 
        className="help-modal-content"
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
                border: '1px solid #ddd',
                backgroundColor: 'white',
                fontSize: '0.9rem',
                fontFamily: "'EmOne', sans-serif",
                color: '#333'
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
          color: '#260000',
          fontSize: isCompactLayout ? '1.3rem' : '1.5rem'
        }}>
          {sections[activeSection].title}
        </h2>

        <div style={{ 
          lineHeight: '1.6',
          color: '#333'
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
    >
      {modalContent}
    </CanvasModal>
  );
};

export default HelpModal;

