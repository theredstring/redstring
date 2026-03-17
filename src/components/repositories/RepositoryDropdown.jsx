/**
 * Repository Dropdown Component
 * A dropdown selector for choosing repositories with an "Add New" option
 */

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Settings,
  Trash2
} from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import { universeManagerService } from '../../services/universeManagerService.js';


const RepositoryDropdown = ({ 
  selectedRepository,
  onSelectRepository,
  placeholder = "Select Repository",
  disabled = false,
  repositories = null,
  onRemoveRepository,
  currentUser
}) => {
  const theme = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSelect = (repository) => {
    onSelectRepository(repository);
    setIsOpen(false);
  };

  const displayText = selectedRepository 
    ? `${selectedRepository.owner?.login || 'user'}/${selectedRepository.name}` 
    : placeholder;

  return (
    <div 
      ref={dropdownRef}
      style={{ 
        position: 'relative',
        fontFamily: "'EmOne', sans-serif"
      }}
    >
      {/* Dropdown Button */}
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        style={{
          width: '100%',
          padding: '6px 10px',
          backgroundColor: theme.canvas.bg,
          color: theme.canvas.text,
          border: '1px solid #979090',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '0.8rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          minWidth: '180px'
        }}
        onMouseEnter={(e) => {
          if (!disabled) {
            e.currentTarget.style.backgroundColor = '#979090';
          }
        }}
        onMouseLeave={(e) => {
          if (!disabled) {
            e.currentTarget.style.backgroundColor = theme.canvas.bg;
          }
        }}
      >
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px',
          overflow: 'hidden'
        }}>
          <span style={{ 
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {displayText}
          </span>
        </div>
        <ChevronDown 
          size={16} 
          style={{ 
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
            flexShrink: 0
          }} 
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            backgroundColor: theme.canvas.bg,
            border: `1px solid ${theme.canvas.text}`,
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            overflow: 'hidden',
            minWidth: '200px'
          }}
        >
          {Array.isArray(repositories) && repositories.length > 0 ? (
            <div style={{ 
              fontFamily: "'EmOne', sans-serif",
              minWidth: '300px'
            }}>
              <div style={{ maxHeight: '200px', overflowY: 'auto', backgroundColor: theme.canvas.bg }}>
                {repositories.map((repo) => (
                  <div
                    key={repo.id || repo.full_name || repo.name}
                    style={{
                      padding: '8px 12px',
                      borderBottom: '1px solid #979090',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s',
                      backgroundColor: theme.canvas.bg
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#979090'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = theme.canvas.bg}
                  >
                    <div style={{ fontWeight: 500, fontSize: '0.85rem', marginBottom: '2px' }}>
                      {repo.full_name || repo.name}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {repo.description || 'No description'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <RepositoryManager
              onSelectRepository={handleSelect}
              showCreateOption={true}
              dropdownMode={true}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default RepositoryDropdown;
