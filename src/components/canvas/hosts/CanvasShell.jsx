import React, { Profiler, memo, useState } from 'react';
import NodeCanvas from '../../../NodeCanvas.jsx';
import HeaderHost from './HeaderHost.jsx';
import PanelHost from './PanelHost.jsx';
import TypeListHost from './TypeListHost.jsx';
import ModalHosts from './ModalHosts.jsx';
import SyncDebugHost from './SyncDebugHost.jsx';
import SearchHosts from './SearchHosts.jsx';
import UniverseHost from './UniverseHost.jsx';
import { useMobileLandscapeShell } from '../../../hooks/useMobileLandscapeShell.js';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';
import { CanvasOverlaySlot } from './canvasOverlaySlot.js';


const containerStyle = {
  // 100% of the safe-area-padded #root. 100vh would include the insets under
  // viewport-fit=cover and push the container past the app box.
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  backgroundColor: 'transparent',
  transition: 'background-color 0.3s ease',
};
const rowStyle = { display: 'flex', flexGrow: 1, position: 'relative', overflow: 'hidden' };
// No box of its own, so the overlays lay out and paint as direct children of
// the container, after TypeList, exactly where NodeCanvas used to put them.
const slotStyle = { display: 'contents' };

/**
 * The app shell (P2.11): Header / [left Panel | canvas | right Panel] / TypeList,
 * then NodeCanvas's overlays. NodeCanvas rendered all of it until now; each host
 * subscribes to the stores itself, so none of them renders with the canvas.
 */
function CanvasShell() {
  const mobileLandscapeShell = useMobileLandscapeShell();
  const [overlayRoot, setOverlayRoot] = useState(null);

  return (
    <div className="node-canvas-container" style={containerStyle} tabIndex="0">
      {/* Header (and with it the Redstring button and its menu) is dropped in
          the fullscreen landscape shell — see useMobileLandscapeShell.js. */}
      <HeaderHost hidden={mobileLandscapeShell} />
      <div style={rowStyle}>
        <PanelHost key="left-panel" side="left" />
        <CanvasOverlaySlot.Provider value={overlayRoot}>
          {/* Render probe (window.__renderProbe). Inert unless ?probe=1 or
              enable(); onRender only fires in dev and in `npm run build:profile`. */}
          <Profiler id="NodeCanvas" onRender={onRenderProbe}>
            <NodeCanvas />
          </Profiler>
        </CanvasOverlaySlot.Provider>
        <PanelHost key="right-panel" side="right" />
      </div>
      {/* TypeList and its bottom-left toggle are dropped in the landscape shell too. */}
      {!mobileLandscapeShell && <TypeListHost />}
      {/* Before the slot: the save pill was the first overlay after TypeList. */}
      <UniverseHost />
      <div ref={setOverlayRoot} style={slotStyle} />
      <ModalHosts />
      <SyncDebugHost />
      <SearchHosts />
    </div>
  );
}

export default memo(CanvasShell);
