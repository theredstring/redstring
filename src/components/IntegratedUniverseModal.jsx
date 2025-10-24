/**
 * Simple Universe Modal - Just GitNativeFederation in a modal
 */

import React from 'react';
import { X } from 'lucide-react';
import GitNativeFederation from '../GitNativeFederation.jsx';

const IntegratedUniverseModal = ({ 
  isOpen = false, 
  onClose = () => {}
}) => {
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
          backgroundColor: '#bdb5b5',
          border: '2px solid #260000',
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
          borderBottom: '2px solid #260000',
          backgroundColor: '#979090'
        }}>
          <div style={{ fontWeight: 'bold', fontSize: '1.2rem', color: '#260000' }}>
            Universe Manager
          </div>
          
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '2px solid #260000',
              color: '#260000',
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

        {/* Just GitNativeFederation in the modal */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <GitNativeFederation />
        </div>
      </div>
    </div>
  );
};

export default IntegratedUniverseModal;
