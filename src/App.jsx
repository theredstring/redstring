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
    root.style.setProperty('--canvas-text', theme.canvas.textPrimary);
    root.style.setProperty('--canvas-text-muted', theme.canvas.textSecondary);
    root.style.setProperty('--canvas-border', theme.canvas.border);
    root.style.setProperty('--canvas-hover', theme.canvas.hover);
    root.style.setProperty('--canvas-active', theme.canvas.active);
    root.style.setProperty('--canvas-inactive', theme.canvas.inactive);

    // Message bubble colors - different for light vs dark mode
    if (darkMode) {
      root.style.setProperty('--bubble-wizard-bg', '#260000');
      root.style.setProperty('--bubble-wizard-text', '#DEDADA');
      root.style.setProperty('--bubble-wizard-border', 'rgba(38, 0, 0, 0.8)');
      root.style.setProperty('--bubble-user-bg', '#201617');
      root.style.setProperty('--bubble-user-text', '#DEDADA');
      root.style.setProperty('--bubble-user-border', 'rgba(32, 22, 23, 0.8)');
    } else {
      root.style.setProperty('--bubble-wizard-bg', '#CCAAA8');
      root.style.setProperty('--bubble-wizard-text', '#260000');
      root.style.setProperty('--bubble-wizard-border', 'rgba(204, 170, 168, 0.8)');
      root.style.setProperty('--bubble-user-bg', '#979090');
      root.style.setProperty('--bubble-user-text', '#260000');
      root.style.setProperty('--bubble-user-border', 'rgba(151, 144, 144, 0.8)');
    }
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
