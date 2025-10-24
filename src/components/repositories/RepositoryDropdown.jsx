/**
 * Repository Dropdown Component
 * A dropdown selector for choosing repositories with an "Add New" option
 */

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Github } from 'lucide-react';
import RepositoryManager from './RepositoryManager.jsx';

const RepositoryDropdown = ({ 
  selectedRepository,
  onSelectRepository,
  placeholder = "Select Repository",
  disabled = false,
  repositories = null,
  onRequireAuth = null
}) => {
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
          padding: '8px 12px',
          backgroundColor: disabled ? '#f0f0f0' : '#bdb5b5',
          border: '1px solid #979090',
          borderRadius: '4px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: '0.9rem',
          fontFamily: "'EmOne', sans-serif",
          color: disabled ? '#999' : '#260000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          textAlign: 'left',
          transition: 'all 0.2s ease'
        }}
        onMouseEnter={(e) => {
          if (!disabled) {
            e.currentTarget.style.backgroundColor = '#979090';
            e.currentTarget.style.borderColor = '#260000';
            e.currentTarget.style.color = '#260000';
          }
        }}
        onMouseLeave={(e) => {
          if (!disabled) {
            e.currentTarget.style.backgroundColor = '#bdb5b5';
            e.currentTarget.style.borderColor = '#979090';
            e.currentTarget.style.color = '#260000';
          }
        }}
      >
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px',
          overflow: 'hidden'
        }}>
          <Github size={16} />
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
            top: '100%',
            left: 0,
            right: 0,
            backgroundColor: '#bdb5b5',
            border: '1px solid #260000',
            borderRadius: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            zIndex: 1000,
            marginTop: '2px',
            overflow: 'hidden'
          }}
        >
          {Array.isArray(repositories) && repositories.length > 0 ? (
            <div style={{ 
              fontFamily: "'EmOne', sans-serif",
              minWidth: '300px'
            }}>
              <div style={{ maxHeight: '200px', overflowY: 'auto', backgroundColor: '#bdb5b5' }}>
                {repositories.map((repo) => (
                  <div
                    key={repo.id || repo.full_name || repo.name}
                    onClick={() => handleSelect(repo)}
                    style={{
                      padding: '8px 12px',
                      borderBottom: '1px solid #979090',
                      cursor: 'pointer',
                      color: '#260000',
                      transition: 'background-color 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#979090';
                      e.currentTarget.style.color = '#260000';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = '#260000';
                    }}
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
