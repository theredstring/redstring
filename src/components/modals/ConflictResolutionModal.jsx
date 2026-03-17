import React, { useState } from 'react';

import { AlertCircle, HardDrive, Github, Calendar, FileText, ArrowRight } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import Modal from '../shared/Modal.jsx';

/**
 * ConflictResolutionModal
 *
 * Shows when local file and Git repository have diverged,
 * allowing user to choose which version to keep.
 */
const ConflictResolutionModal = ({
  isOpen,
  onClose,
  onResolve,
  localData,
  gitData,
  universeName,
  requiresPrimarySelection = false
}) => {
  const theme = useTheme();
  const [selectedResolution, setSelectedResolution] = useState('local'); // 'local', 'remote', 'manual'

  if (!isOpen) return null;

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Unknown';
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return 'Unknown';
    }
  };

  const buttonStyle = (isPrimary, color = '#260000') => ({
    padding: '10px 20px',
    borderRadius: 6,
    fontSize: '0.9rem',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'EmOne', sans-serif",
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    border: `2px solid ${color}`,
    backgroundColor: isPrimary ? color : 'transparent',
    color: isPrimary ? theme.canvas.bg : color
  });

  const headerTitle = requiresPrimarySelection ? 'Select Primary Storage' : 'Data Conflict Detected';
  const descriptionContent = requiresPrimarySelection ? (
    <>
      The local file and Git repository for <strong>{universeName}</strong> are available, but no primary source has been set yet. Choose which storage should become the source of truth going forward.
    </>
  ) : (
    <>
      The local file and Git repository for <strong>{universeName}</strong> have different data. Choose which version to keep:
    </>
  );

  const localButtonLabel = requiresPrimarySelection ? 'Make Local Primary' : 'Use Local File';
  const gitButtonLabel = requiresPrimarySelection ? 'Make Git Primary' : 'Use Git Version';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '20px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 'min(90vw, 520px)',
          backgroundColor: theme.canvas.bg,
          border: '3px solid #260000',
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          fontFamily: "'EmOne', sans-serif",
          maxHeight: 'calc(100vh - 40px)',
          margin: '20px 0',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '20px 24px',
            borderBottom: '2px solid #260000',
            backgroundColor: '#979090',
            flexShrink: 0
          }}
        >
          <div style={{ color: '#ef6c00', flexShrink: 0 }}>
            <AlertCircle size={24} />
          </div>
          <h2
            style={{
              margin: 0,
              fontSize: '1.05rem',
              fontWeight: 700,
              color: '#260000'
            }}
          >
            {headerTitle}
          </h2>
        </div>

        {/* Content */}
        <div
          style={{
            padding: '26px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            overflowY: 'auto',
            flex: 1,
            minHeight: 0
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: '0.85rem',
              lineHeight: 1.5,
              color: '#260000'
            }}
          >
            {descriptionContent}
          </p>

          {/* Comparison Cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Local File Card */}
            <div
              style={{
                border: '2px solid #260000',
                borderRadius: 8,
                backgroundColor: '#cfc6c6',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  padding: '12px 16px',
                  backgroundColor: '#979090',
                  borderBottom: '1px solid #260000',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10
                }}
              >
                <HardDrive size={18} style={{ color: '#260000' }} />
                <span style={{ fontWeight: 700, fontSize: '1rem', color: '#260000' }}>
                  Local File
                </span>
              </div>
              <div style={{ padding: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                    <FileText size={14} style={{ color: '#666' }} />
                    <span style={{ fontWeight: 600, color: '#260000' }}>Nodes:</span>
                    <span style={{ color: '#666' }}>{localData?.nodeCount || 0}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                    <FileText size={14} style={{ color: '#666' }} />
                    <span style={{ fontWeight: 600, color: '#260000' }}>Graphs:</span>
                    <span style={{ color: '#666' }}>{localData?.graphCount || 0}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem' }}>
                    <Calendar size={14} style={{ color: '#666' }} />
                    <span style={{ fontWeight: 600, color: '#260000' }}>Last Modified:</span>
                    <span style={{ color: '#666' }}>{formatTimestamp(localData?.timestamp)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Git Repository Card */}
            <div
              style={{
                border: '2px solid #260000',
                borderRadius: 8,
                backgroundColor: '#cfc6c6',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  padding: '12px 16px',
                  backgroundColor: '#979090',
                  borderBottom: '1px solid #260000',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10
                }}
              >
                <Github size={18} style={{ color: '#260000' }} />
                <span style={{ fontWeight: 700, fontSize: '1rem', color: '#260000' }}>
                  Git Repository
                </span>
              </div>
              <div style={{ padding: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                    <FileText size={14} style={{ color: '#666' }} />
                    <span style={{ fontWeight: 600, color: '#260000' }}>Nodes:</span>
                    <span style={{ color: '#666' }}>{gitData?.nodeCount || 0}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                    <FileText size={14} style={{ color: '#666' }} />
                    <span style={{ fontWeight: 600, color: '#260000' }}>Graphs:</span>
                    <span style={{ color: '#666' }}>{gitData?.graphCount || 0}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem' }}>
                    <Calendar size={14} style={{ color: '#666' }} />
                    <span style={{ fontWeight: 600, color: '#260000' }}>Last Modified:</span>
                    <span style={{ color: '#666' }}>{formatTimestamp(gitData?.timestamp)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Warning */}
          <div
            style={{
              marginTop: 16,
              padding: '10px 14px',
              backgroundColor: 'rgba(122, 0, 0, 0.1)',
              border: '1px solid #7A0000',
              borderRadius: 6,
              fontSize: '0.78rem',
              color: '#7A0000',
              lineHeight: 1.5
            }}
          >
            <strong>⚠ Warning:</strong> The version you don't choose will be overwritten. Make sure to save a backup if needed.
          </div>
        </div>

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            padding: '12px',
            borderTop: '1px solid #979090',
            backgroundColor: theme.canvas.bg,
            justifyContent: 'flex-end',
            flexShrink: 0
          }}
        >
          <button
            onClick={onClose}
            style={{
              ...buttonStyle(false, '#666'),
              flexShrink: 0,
              padding: '6px 12px',
              fontSize: '0.75rem'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(102, 102, 102, 0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            Cancel
          </button>
          <div style={{ display: 'flex', gap: 12 }}>
            <div
              style={{
                padding: '16px',
                border: `2px solid ${selectedResolution === 'local' ? theme.canvas.text : '#979090'}`,
                borderRadius: '8px',
                backgroundColor: selectedResolution === 'local' ? '#cfc6c6' : theme.canvas.bg,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.2s'
              }}
              onClick={() => setSelectedResolution('local')}
              onMouseEnter={(e) => {
                if (selectedResolution !== 'local') {
                  e.currentTarget.style.backgroundColor = '#cfc6c6';
                }
              }}
              onMouseLeave={(e) => {
                if (selectedResolution !== 'local') {
                  e.currentTarget.style.backgroundColor = theme.canvas.bg;
                }
              }}
            >
              <button
                onClick={() => onResolve('local')}
                style={{
                  ...buttonStyle(true, '#260000'),
                  padding: '8px 14px',
                  fontSize: '0.78rem'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#1a0000';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#260000';
                }}
              >
                <HardDrive size={16} />
                {localButtonLabel}
              </button>
            </div>
            <button
              onClick={() => onResolve('git')}
              style={{
                ...buttonStyle(true, '#7A0000'),
                padding: '8px 14px',
                fontSize: '0.78rem'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#5a0000';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#7A0000';
              }}
            >
              <Github size={16} />
              {gitButtonLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConflictResolutionModal;
