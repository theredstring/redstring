/**
 * Simple Universe Modal - Just UniverseManager in a modal
 */

import React from 'react';
import { X } from 'lucide-react';
import UniverseManager from '../UniverseManager.jsx';
import { useTheme } from '../hooks/useTheme.js';

const IntegratedUniverseModal = ({ 
  isOpen = false, 
  onClose = () => {}
}) => {
  const theme = useTheme();
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2000,
      fontFamily: "'EmOne', sans-serif"
    }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(95vw, 800px)',
          height: 'min(95vh, 700px)',
          backgroundColor: theme.canvas.bg,
          border: `2px solid ${theme.canvas.textPrimary}`,
          borderRadius: '12px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: `2px solid ${theme.canvas.textPrimary}`,
          backgroundColor: theme.canvas.border
        }}>
          <div style={{ fontWeight: 'bold', fontSize: '1.2rem', color: theme.canvas.textPrimary }}>
            Universe Manager
          </div>
          
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: `2px solid ${theme.canvas.textPrimary}`,
              color: theme.canvas.textPrimary,
              cursor: 'pointer',
              fontSize: '1.2rem',
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 'bold'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Just UniverseManager in the modal */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <UniverseManager />
        </div>
      </div>
    </div>
  );
};

export default IntegratedUniverseModal;
