import React, { useEffect } from 'react';
import NodeCanvas from './NodeCanvas';
import SpawningNodeDragLayer from './SpawningNodeDragLayer';
import BridgeClient from './ai/BridgeClient.jsx';
import GlobalContextMenu from './components/GlobalContextMenu.jsx';
import UniverseManagerBootstrap from './components/UniverseManagerBootstrap.jsx';
import useGraphStore from './store/graphStore.jsx';
import './App.css';

function App() {
  const darkMode = useGraphStore(s => s.darkMode);

  useEffect(() => {
    if (darkMode) {
      document.body.style.backgroundColor = '#3F3A3A';
    } else {
      document.body.style.backgroundColor = '';
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
