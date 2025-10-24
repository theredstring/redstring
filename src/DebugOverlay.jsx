import React, { useState, useEffect } from 'react';
import './DebugOverlay.css';
import { HEADER_HEIGHT, PANEL_CLOSE_ICON_SIZE } from './constants';
import { X } from 'lucide-react';

const DebugOverlay = ({ debugData, hideOverlay }) => {
  const [position, setPosition] = useState({ x: window.innerWidth - 400, y: HEADER_HEIGHT });
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ width: 400, height: window.innerHeight - HEADER_HEIGHT - 100 });
  const [resizing, setResizing] = useState(false);
  const [resizeInitial, setResizeInitial] = useState(null);

  const handleMouseDown = (e) => {
    setDragging(true);
    setOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e) => {
    if (dragging) {
      window.requestAnimationFrame(() => {
        setPosition({ x: e.clientX - offset.x, y: e.clientY - offset.y });
      });
    }
  };

  const handleMouseUp = () => {
    setDragging(false);
  };

  const handleResizeMouseDown = (e) => {
    e.stopPropagation();
    setResizing(true);
    setResizeInitial({
      mouseX: e.clientX,
      mouseY: e.clientY,
      width: size.width,
      height: size.height
    });
  };

  const handleResizeMouseMove = (e) => {
    if (resizing && resizeInitial) {
      const newWidth = resizeInitial.width + (e.clientX - resizeInitial.mouseX);
      const newHeight = resizeInitial.height + (e.clientY - resizeInitial.mouseY);
      setSize({
        width: Math.max(newWidth, 200),
        height: Math.max(newHeight, 100)
      });
    }
  };

  const handleResizeMouseUp = () => {
    setResizing(false);
    setResizeInitial(null);
  };

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, offset, position]);

  useEffect(() => {
    if (resizing) {
      window.addEventListener('mousemove', handleResizeMouseMove);
      window.addEventListener('mouseup', handleResizeMouseUp);
    } else {
      window.removeEventListener('mousemove', handleResizeMouseMove);
      window.removeEventListener('mouseup', handleResizeMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleResizeMouseMove);
      window.removeEventListener('mouseup', handleResizeMouseUp);
    };
  }, [resizing, resizeInitial, size]);

  return (
    <div 
      className="debug-overlay"
      style={{
        position: 'fixed',
        top: position.y,
        left: position.x,
        width: `${size.width}px`,
        height: `${size.height}px`,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        color: '#EFE8E5',
        padding: '20px',
        fontFamily: 'monospace',
        fontSize: '12px',
        overflow: 'auto',
        zIndex: 20000,
        borderRadius: '10px'
      }}
    >
      <div 
        className="drag-handle"
        style={{
          width: '60px',
          height: '6px',
          backgroundColor: '#EFE8E5',
          borderRadius: '3px',
          margin: '8px auto',
          cursor: 'grab'
        }}
        onMouseDown={handleMouseDown}
      />
      <div style={{ 
        position: 'sticky', 
        top: 0, 
        backgroundColor: 'rgba(0, 0, 0, 0.9)', 
        padding: '5px 10px',
        marginBottom: '10px',
        borderBottom: '1px solid rgba(255,255,255,0.2)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <strong>Debug Mode</strong>
        <button 
          onClick={hideOverlay} 
          style={{ 
            background: 'none', 
            border: 'none', 
            color: '#EFE8E5', 
            cursor: 'pointer',
            padding: 0
          }}
          aria-label="Close debug overlay"
        >
          <X size={PANEL_CLOSE_ICON_SIZE} />
        </button>
      </div>

      {debugData && typeof debugData === 'object' && Object.entries(debugData).map(([key, value]) => (
        <div key={key} style={{ 
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          padding: '5px 0',
          marginBottom: '5px'
        }}>
          <strong style={{ color: '#66d9ef' }}>{key}:</strong>
          <pre style={{ 
            margin: '5px 0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all'
          }}>
            {typeof value === 'object' ? JSON.stringify(value, null, 2) : value}
          </pre>
        </div>
      ))}
      <div style={{ marginTop: '10px', borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: '10px' }}>
        <strong>Full Debug Data:</strong>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, fontFamily: "'EmOne', sans-serif", fontSize: '12px' }}>
          {debugData ? JSON.stringify(debugData, null, 2) : 'No debug data'}
        </pre>
      </div>
      <div
        className="resize-handle"
        style={{
          position: 'absolute',
          bottom: '0',
          right: '0',
          width: '20px',
          height: '20px',
          cursor: 'se-resize',
          background: 'transparent'
        }}
        onMouseDown={handleResizeMouseDown}
      />
    </div>
  );
};

export default DebugOverlay;