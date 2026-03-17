import React, { useEffect } from 'react';
import NodeCanvas from './NodeCanvas';
import SpawningNodeDragLayer from './SpawningNodeDragLayer';
import BridgeClient from './ai/BridgeClient.jsx';
import GlobalContextMenu from './components/GlobalContextMenu.jsx';
import UniverseManagerBootstrap from './components/UniverseManagerBootstrap.jsx';
import useGraphStore from './store/graphStore.jsx';
import { DARK_THEME, LIGHT_THEME } from './utils/themeColors.js';
import './App.css';

function App() {
  const darkMode = useGraphStore(s => s.darkMode);

  useEffect(() => {
    const theme = darkMode ? DARK_THEME : LIGHT_THEME;
    const root = document.documentElement;

    // Set background color on body
    document.body.style.backgroundColor = theme.canvas.bg;

    // Add/remove dark-mode class on html element for CSS
    root.classList.toggle('dark-mode', darkMode);

    // Set CSS variables for use in stylesheets
    root.style.setProperty('--canvas-bg', theme.canvas.bg);
    root.style.setProperty('--canvas-text', theme.canvas.text);
    root.style.setProperty('--canvas-text-muted', theme.canvas.textMuted);
    root.style.setProperty('--canvas-border', theme.canvas.border);
    root.style.setProperty('--canvas-hover', theme.canvas.hover);
    root.style.setProperty('--canvas-active', theme.canvas.active);
    root.style.setProperty('--canvas-inactive', theme.canvas.inactive);
  }, [darkMode]);

  return (
    <>
      {/* UniverseManagerBootstrap handles backend initialization */}
      <UniverseManagerBootstrap enableEagerInit={true} />
      <NodeCanvas />
      <SpawningNodeDragLayer />
      <BridgeClient />
      <GlobalContextMenu />
    </>
  );
}

export default App;
