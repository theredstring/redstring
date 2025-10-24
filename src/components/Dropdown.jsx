import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import './Dropdown.css';

/**
 * Reusable Dropdown Component
 * Matches the Redstring app's visual style with proper focus management
 */
const Dropdown = ({ 
  options, 
  value, 
  onChange, 
  rightContent = null,
  className = '',
  placeholder = 'Select option...'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const buttonRef = useRef(null);

  // Find the selected option
  const selectedOption = options.find(option => option.value === value);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close dropdown on escape key
  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  const handleSelect = (option) => {
    onChange(option.value);
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setIsOpen(!isOpen);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else {
        // Focus first option
        const firstOption = dropdownRef.current?.querySelector('.dropdown-option');
        firstOption?.focus();
      }
    }
  };

  const handleOptionKeyDown = (event, option) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSelect(option);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextElement = event.target.nextElementSibling;
      if (nextElement) {
        nextElement.focus();
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prevElement = event.target.previousElementSibling;
      if (prevElement) {
        prevElement.focus();
      } else {
        buttonRef.current?.focus();
        setIsOpen(false);
      }
    }
  };

  return (
    <div className={`dropdown-control ${className}`}>
      <div className="dropdown-container" ref={dropdownRef}>
        <button
          ref={buttonRef}
          className={`dropdown-button ${isOpen ? 'open' : ''}`}
          onClick={() => setIsOpen(!isOpen)}
          onKeyDown={handleKeyDown}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label="Select connection scope"
        >
          <span className="dropdown-selected">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <ChevronDown 
            size={16} 
            className={`dropdown-icon ${isOpen ? 'rotated' : ''}`} 
          />
        </button>
        
        {isOpen && (
          <div className="dropdown-menu" role="listbox">
            {options.map((option) => (
              <div
                key={option.value}
                className={`dropdown-option ${value === option.value ? 'selected' : ''}`}
                onClick={() => handleSelect(option)}
                onKeyDown={(e) => handleOptionKeyDown(e, option)}
                role="option"
                aria-selected={value === option.value}
                tabIndex={0}
              >
                {option.label}
              </div>
            ))}
          </div>
        )}
      </div>
      
      {rightContent && (
        <div className="dropdown-right-content">
          {rightContent}
        </div>
      )}
    </div>
  );
};

export default Dropdown;
