import React, { useState } from 'react';
import { Plus, Check } from 'lucide-react';
import Modal from '../shared/Modal.jsx';

/**
 * UniverseLinkingModal
 *
 * Allows user to select an existing universe or create a new one
 * when linking a Git repository to a universe.
 *
 * Color scheme: Maroon/red (#260000, #7A0000) with gray tones (#bdb5b5, #979090, #cfc6c6)
 */
const UniverseLinkingModal = ({
  isOpen,
  onClose,
  onSelectExisting,
  onCreateNew,
  existingUniverses = [],
  suggestedName = '',
  repositoryName = ''
}) => {
  const [mode, setMode] = useState('select'); // 'select' or 'create'
  const [selectedSlug, setSelectedSlug] = useState(null);
  const [newUniverseName, setNewUniverseName] = useState(suggestedName);

  const handleConfirm = () => {
    if (mode === 'select' && selectedSlug) {
      onSelectExisting(selectedSlug);
    } else if (mode === 'create' && newUniverseName.trim()) {
      onCreateNew(newUniverseName.trim());
    }
  };

  const canConfirm = mode === 'select' ? !!selectedSlug : !!newUniverseName.trim();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Link Repository to Universe"
      size="medium"
    >
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        overflow: 'hidden'
      }}>
        {/* Info banner */}
        <div style={{
          padding: '12px',
          backgroundColor: 'rgba(122,0,0,0.08)',
          borderBottom: '1px solid #979090',
          color: '#260000',
          fontSize: '0.78rem',
          lineHeight: 1.4,
          flexShrink: 0
        }}>
          Link <strong>{repositoryName}</strong> to an existing universe or create a new one.
        </div>

        {/* Mode toggle buttons */}
        <div style={{
          display: 'flex',
          gap: '8px',
          padding: '12px',
          borderBottom: '1px solid #979090',
          backgroundColor: '#bdb5b5',
          flexShrink: 0
        }}>
          <button
            onClick={() => setMode('select')}
            style={{
              flex: 1,
              padding: '8px 12px',
              border: '1px solid #260000',
              borderRadius: '4px',
              backgroundColor: mode === 'select' ? '#260000' : 'transparent',
              color: mode === 'select' ? '#bdb5b5' : '#260000',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 600,
              fontFamily: "'EmOne', sans-serif",
              transition: 'all 0.2s'
            }}
          >
            Select Existing
          </button>
          <button
            onClick={() => setMode('create')}
            style={{
              flex: 1,
              padding: '8px 12px',
              border: '1px solid #260000',
              borderRadius: '4px',
              backgroundColor: mode === 'create' ? '#260000' : 'transparent',
              color: mode === 'create' ? '#bdb5b5' : '#260000',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 600,
              fontFamily: "'EmOne', sans-serif",
              transition: 'all 0.2s'
            }}
          >
            <Plus size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
            Create New
          </button>
        </div>

        {/* Content area */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '12px'
        }}>
          {mode === 'select' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {existingUniverses.length === 0 ? (
                <div style={{
                  padding: '40px',
                  textAlign: 'center',
                  color: '#666',
                  fontSize: '0.85rem'
                }}>
                  No existing universes found. Create a new one instead.
                </div>
              ) : (
                existingUniverses.map(universe => (
                  <button
                    key={universe.slug}
                    onClick={() => setSelectedSlug(universe.slug)}
                    style={{
                      padding: '12px',
                      border: `2px solid ${selectedSlug === universe.slug ? '#260000' : '#979090'}`,
                      borderRadius: '6px',
                      backgroundColor: selectedSlug === universe.slug ? '#cfc6c6' : '#bdb5b5',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      transition: 'all 0.2s',
                      position: 'relative'
                    }}
                    onMouseEnter={(e) => {
                      if (selectedSlug !== universe.slug) {
                        e.currentTarget.style.backgroundColor = '#979090';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedSlug !== universe.slug) {
                        e.currentTarget.style.backgroundColor = '#bdb5b5';
                      }
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontWeight: 600,
                        fontSize: '0.85rem',
                        color: '#260000',
                        marginBottom: '4px'
                      }}>
                        {universe.name}
                      </div>
                      {universe.nodeCount !== undefined && (
                        <div style={{
                          fontSize: '0.7rem',
                          color: '#666'
                        }}>
                          {universe.nodeCount} nodes
                          {universe.storage?.primary?.type && ` • ${universe.storage.primary.type}`}
                        </div>
                      )}
                    </div>
                    {selectedSlug === universe.slug && (
                      <Check size={20} style={{ color: '#260000', flexShrink: 0 }} />
                    )}
                  </button>
                ))
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#260000',
                  marginBottom: '6px'
                }}>
                  Universe Name
                </label>
                <input
                  type="text"
                  value={newUniverseName}
                  onChange={(e) => setNewUniverseName(e.target.value)}
                  placeholder="Enter universe name"
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #979090',
                    borderRadius: '4px',
                    fontSize: '0.85rem',
                    backgroundColor: '#bdb5b5',
                    color: '#260000',
                    fontFamily: "'EmOne', sans-serif",
                    boxSizing: 'border-box'
                  }}
                />
              </div>
              <div style={{
                padding: '10px',
                backgroundColor: 'rgba(122,0,0,0.05)',
                borderRadius: '4px',
                fontSize: '0.72rem',
                color: '#666',
                lineHeight: 1.4
              }}>
                A new universe will be created and linked to this repository.
                The repository will become the primary storage location.
              </div>
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div style={{
          display: 'flex',
          gap: '8px',
          padding: '12px',
          borderTop: '1px solid #979090',
          backgroundColor: '#bdb5b5',
          justifyContent: 'flex-end',
          flexShrink: 0
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              border: '1px solid #979090',
              borderRadius: '4px',
              backgroundColor: 'transparent',
              color: '#260000',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 600,
              fontFamily: "'EmOne', sans-serif"
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{
              padding: '8px 16px',
              border: '1px solid #7A0000',
              borderRadius: '4px',
              backgroundColor: canConfirm ? '#7A0000' : '#979090',
              color: '#fff',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              fontSize: '0.8rem',
              fontWeight: 600,
              fontFamily: "'EmOne', sans-serif",
              opacity: canConfirm ? 1 : 0.6
            }}
          >
            {mode === 'select' ? 'Link to Universe' : 'Create & Link'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default UniverseLinkingModal;
