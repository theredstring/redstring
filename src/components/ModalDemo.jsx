import React, { useState } from 'react';
import CanvasModal from './CanvasModal';
import PanelModal from './PanelModal';
import AlphaOnboardingModal from './AlphaOnboardingModal';
import './ModalComponents.css';

/**
 * Demo component showing how to use CanvasModal and PanelModal
 * This demonstrates the different positioning options and usage patterns
 */
const ModalDemo = () => {
  const [canvasModalVisible, setCanvasModalVisible] = useState(false);
  const [panelModalVisible, setPanelModalVisible] = useState(false);
  const [alphaModalVisible, setAlphaModalVisible] = useState(false);
  const [canvasPosition, setCanvasPosition] = useState('center');
  const [panelSide, setPanelSide] = useState('right');

  const demoCanvasContent = (
    <div>
      <h4 style={{ margin: '0 0 12px 0', color: '#260000' }}>Canvas Modal Demo</h4>
      <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', lineHeight: '1.4' }}>
        This modal is positioned within the canvas viewport area.
        It uses the same viewport calculations as EdgeGlowIndicator and UnifiedSelector.
      </p>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold' }}>
          Position:
        </label>
        <select
          value={canvasPosition}
          onChange={(e) => setCanvasPosition(e.target.value)}
          style={{
            padding: '6px 8px',
            border: '1px solid #260000',
            borderRadius: '4px',
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            fontFamily: "'EmOne', sans-serif"
          }}
        >
          <option value="center">Center</option>
          <option value="top-left">Top Left</option>
          <option value="top-right">Top Right</option>
          <option value="bottom-left">Bottom Left</option>
          <option value="bottom-right">Bottom Right</option>
        </select>
      </div>

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button
          onClick={() => setCanvasModalVisible(false)}
          style={{
            padding: '8px 16px',
            border: 'none',
            borderRadius: '6px',
            backgroundColor: '#666',
            color: 'white',
            cursor: 'pointer',
            fontFamily: "'EmOne', sans-serif"
          }}
        >
          Close
        </button>
        <button
          onClick={() => {
            setCanvasModalVisible(false);
            setPanelModalVisible(true);
          }}
          style={{
            padding: '8px 16px',
            border: 'none',
            borderRadius: '6px',
            backgroundColor: '#8B0000',
            color: '#bdb5b5',
            cursor: 'pointer',
            fontFamily: "'EmOne', sans-serif"
          }}
        >
          Show Panel Modal
        </button>
      </div>
    </div>
  );

  const demoPanelContent = (
    <div>
      <h4 style={{ margin: '0 0 12px 0', color: '#260000' }}>Panel Modal Demo</h4>
      <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', lineHeight: '1.4' }}>
        This modal is positioned within the panel area.
        Choose which panel to show it in using the controls below.
      </p>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold' }}>
          Panel Side:
        </label>
        <select
          value={panelSide}
          onChange={(e) => setPanelSide(e.target.value)}
          style={{
            padding: '6px 8px',
            border: '1px solid #260000',
            borderRadius: '4px',
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            fontFamily: "'EmOne', sans-serif"
          }}
        >
          <option value="left">Left Panel</option>
          <option value="right">Right Panel</option>
        </select>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <h5 style={{ margin: '0 0 8px 0', fontSize: '0.9rem' }}>Features:</h5>
        <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.8rem' }}>
          <li>Canvas-colored background (#bdb5b5)</li>
          <li>Maroon borders (#260000)</li>
          <li>Drop shadow for depth</li>
          <li>Responsive margins</li>
          <li>Escape key support</li>
          <li>Backdrop click to close</li>
        </ul>
      </div>

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button
          onClick={() => setPanelModalVisible(false)}
          style={{
            padding: '8px 16px',
            border: 'none',
            borderRadius: '6px',
            backgroundColor: '#666',
            color: 'white',
            cursor: 'pointer',
            fontFamily: "'EmOne', sans-serif"
          }}
        >
          Close
        </button>
        <button
          onClick={() => {
            setPanelModalVisible(false);
            setCanvasModalVisible(true);
          }}
          style={{
            padding: '8px 16px',
            border: 'none',
            borderRadius: '6px',
            backgroundColor: '#8B0000',
            color: '#bdb5b5',
            cursor: 'pointer',
            fontFamily: "'EmOne', sans-serif"
          }}
        >
          Show Canvas Modal
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ padding: '20px', fontFamily: "'EmOne', sans-serif" }}>
      <h2 style={{ margin: '0 0 20px 0', color: '#260000' }}>Modal Components Demo</h2>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <button
          onClick={() => setCanvasModalVisible(true)}
          style={{
            padding: '12px 20px',
            border: '2px solid #8B0000',
            borderRadius: '8px',
            backgroundColor: '#bdb5b5',
            color: '#260000',
            cursor: 'pointer',
            fontFamily: "'EmOne', sans-serif",
            fontSize: '1rem',
            fontWeight: 'bold'
          }}
        >
          Show Canvas Modal
        </button>

        <button
          onClick={() => setPanelModalVisible(true)}
          style={{
            padding: '12px 20px',
            border: '2px solid #8B0000',
            borderRadius: '8px',
            backgroundColor: '#bdb5b5',
            color: '#260000',
            cursor: 'pointer',
            fontFamily: "'EmOne', sans-serif",
            fontSize: '1rem',
            fontWeight: 'bold'
          }}
        >
          Show Panel Modal
        </button>

        <button
          onClick={() => setAlphaModalVisible(true)}
          style={{
            padding: '12px 20px',
            border: '2px solid #8B0000',
            borderRadius: '8px',
            backgroundColor: '#bdb5b5',
            color: '#260000',
            cursor: 'pointer',
            fontFamily: "'EmOne', sans-serif",
            fontSize: '1rem',
            fontWeight: 'bold'
          }}
        >
          Show Alpha Welcome
        </button>

        <button
          onClick={() => {
            if (typeof window !== 'undefined') {
              localStorage.removeItem('redstring-alpha-welcome-seen');
              localStorage.removeItem('redstring-has-used-before');
              alert('LocalStorage cleared! Refresh the page to see first-time experience.');
            }
          }}
          style={{
            padding: '12px 20px',
            border: '2px solid #666',
            borderRadius: '8px',
            backgroundColor: '#f8f8f8',
            color: '#666',
            cursor: 'pointer',
            fontFamily: "'EmOne', sans-serif",
            fontSize: '1rem',
            fontWeight: 'bold'
          }}
        >
          Reset First-Time Experience
        </button>
      </div>

      <p style={{ margin: '20px 0', fontSize: '0.9rem', color: '#666' }}>
        These modals use the same viewport calculation system as EdgeGlowIndicator and UnifiedSelector.
        They automatically position themselves within the available canvas or panel space with proper margins.
      </p>

      <div style={{
        marginTop: '20px',
        padding: '16px',
        backgroundColor: 'rgba(139, 0, 0, 0.05)',
        borderRadius: '8px',
        border: '1px solid rgba(139, 0, 0, 0.2)'
      }}>
        <h4 style={{ margin: '0 0 12px 0', color: '#8B0000', fontSize: '1rem' }}>
          🧪 Testing Features
        </h4>
        <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.85rem', color: '#666' }}>
          <li><strong>Alpha Modal:</strong> Shows welcome message for Redstring's open alpha</li>
          <li><strong>Reset Button:</strong> Clears localStorage to test first-time experience</li>
          <li><strong>Keyboard Shortcut:</strong> <code>Ctrl+W</code> to show alpha modal anywhere in the app</li>
          <li><strong>Auto-show:</strong> Appears automatically on first app launch</li>
        </ul>
      </div>

      {/* Canvas Modal */}
      <CanvasModal
        isVisible={canvasModalVisible}
        onClose={() => setCanvasModalVisible(false)}
        title="Canvas Modal"
        width={400}
        position={canvasPosition}
        margin={20}
      >
        {demoCanvasContent}
      </CanvasModal>

      {/* Panel Modal */}
      <PanelModal
        isVisible={panelModalVisible}
        onClose={() => setPanelModalVisible(false)}
        title="Panel Modal"
        width={320}
        panel={panelSide}
        position="center"
        margin={16}
      >
        {demoPanelContent}
      </PanelModal>

      {/* Alpha Onboarding Modal */}
      <AlphaOnboardingModal
        isVisible={alphaModalVisible}
        onClose={() => setAlphaModalVisible(false)}
        onDontShowAgain={() => console.log('User chose not to show alpha welcome again')}
        width={520}
        height={720}
        margin={20}
      />
    </div>
  );
};

export default ModalDemo;
