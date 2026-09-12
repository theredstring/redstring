import React, { useState } from 'react';
import { Plus, Check } from 'lucide-react';
import Modal from '../shared/Modal.jsx';
import { DialogButton, DialogInput } from '../shared/Dialog.jsx';
import { useTheme } from '../../hooks/useTheme.js';


/**
 * UniverseLinkingModal
 *
 * Allows user to select an existing universe or create a new one
 * when linking a Git repository to a universe.
 *
 * Color scheme: Uses Unified Theming System (defaults to maroon/red based on active graph)
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
  const theme = useTheme();
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
          backgroundColor: theme.darkMode ? 'rgba(122,0,0,0.15)' : 'rgba(122,0,0,0.08)',
          borderBottom: `1px solid ${theme.canvas.border}`,
          color: theme.canvas.textPrimary,
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
          borderBottom: `1px solid ${theme.canvas.border}`,
          backgroundColor: theme.canvas.bg,
          flexShrink: 0
        }}>
          {/* A pill standing in for a radio, as the Settings option groups do.
              `flex: 1` is what keeps the pair sharing the row rather than each
              sizing to its own label. */}
          <DialogButton
            label="Select Existing"
            tone={mode === 'select' ? 'primary' : 'neutral'}
            onClick={() => setMode('select')}
            style={{ flex: 1 }}
          />
          <DialogButton
            icon={Plus}
            label="Create New"
            tone={mode === 'create' ? 'primary' : 'neutral'}
            onClick={() => setMode('create')}
            style={{ flex: 1 }}
          />
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
                  color: theme.canvas.textSecondary,
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
                      border: `2px solid ${selectedSlug === universe.slug ? theme.canvas.textPrimary : theme.canvas.border}`,
                      borderRadius: '6px',
                      backgroundColor: selectedSlug === universe.slug ? theme.canvas.hover : theme.canvas.bg,
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
                        e.currentTarget.style.backgroundColor = theme.canvas.border;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedSlug !== universe.slug) {
                        e.currentTarget.style.backgroundColor = theme.canvas.bg;
                      }
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontWeight: 600,
                        fontSize: '0.85rem',
                        color: theme.canvas.textPrimary,
                        marginBottom: '4px'
                      }}>
                        {universe.name}
                      </div>
                      {universe.nodeCount !== undefined && (
                        <div style={{
                          fontSize: '0.7rem',
                          color: theme.canvas.textSecondary
                        }}>
                          {universe.nodeCount} nodes
                          {universe.storage?.primary?.type && ` • ${universe.storage.primary.type}`}
                        </div>
                      )}
                    </div>
                    {selectedSlug === universe.slug && (
                      <Check size={20} style={{ color: theme.canvas.textPrimary, flexShrink: 0 }} />
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
                  color: theme.canvas.textPrimary,
                  marginBottom: '6px'
                }}>
                  Universe Name
                </label>
                <DialogInput
                  type="text"
                  value={newUniverseName}
                  onChange={(e) => setNewUniverseName(e.target.value)}
                  placeholder="Enter universe name"
                  autoFocus
                />
              </div>
              <div style={{
                padding: '10px',
                backgroundColor: theme.darkMode ? 'rgba(122,0,0,0.1)' : 'rgba(122,0,0,0.05)',
                borderRadius: '4px',
                fontSize: '0.72rem',
                color: theme.canvas.textSecondary,
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
          borderTop: `1px solid ${theme.canvas.border}`,
          backgroundColor: theme.canvas.bg,
          justifyContent: 'flex-end',
          flexShrink: 0
        }}>
          <DialogButton label="Cancel" onClick={onClose} />
          <DialogButton
            label={mode === 'select' ? 'Link to Universe' : 'Create & Link'}
            tone="accent"
            disabled={!canConfirm}
            onClick={handleConfirm}
          />
        </div>
      </div>
    </Modal>
  );
};

export default UniverseLinkingModal;
