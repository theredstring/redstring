// The app itself, loaded by src/main.jsx once the desktop app's one-time
// storage migration (if any) has finished — so no module here can read
// localStorage or IndexedDB before it is in place.
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { DndProvider } from 'react-dnd'
import { TouchBackend } from 'react-dnd-touch-backend'
import DragSessionGuards from './components/DragSessionGuards.jsx'

// Initialize debug configuration early
import './utils/debugConfig.js'

// Canvas render diagnostics — exposes window.__diag. Inert until invoked.
import './utils/canvasDiagnostics.js'

// Initialize Pretext text measurement (sets up font-load cache invalidation)
import { initTextMeasurement } from './services/textMeasurement.js'
initTextMeasurement()

// Every drag — mouse and touch — runs on pointer events, through the touch
// backend with mouse events turned on. Mouse drags used the browser's native
// drag and drop until the wheel had to work mid-drag: during a native drag the
// browser runs its own drag session and the page receives no wheel at all, so
// a long Open Webs list or header strip couldn't be scrolled while carrying a
// web. On pointer events a drag is just a held button moving, and the wheel,
// the trackpad and everything else carry on as normal. What the native drag
// did for free (refusing files dropped on the page, eating the click after a
// release, no text selection) is in DragSessionGuards.
//
// The press is listened for at window in the capture phase, ahead of
// everything: the backend's own listener sits at the document in the bubble
// phase, where any stopPropagation on the way up (a collapsible section, a
// panel) hides the press and nothing inside it can be dragged. Moves and
// releases stay at the document, where the backend's drop-target matching
// expects them (it collects targets from listeners on <body> in between).
const DRAG_START_EVENTS = new Set(['mousedown', 'touchstart'])
const asCapture = (options) => ({ ...(typeof options === 'object' ? options : {}), capture: true })
const dragEventRoot = {
  addEventListener: (type, handler, options) => (DRAG_START_EVENTS.has(type)
    ? window.addEventListener(type, handler, asCapture(options))
    : document.addEventListener(type, handler, options)),
  removeEventListener: (type, handler, options) => (DRAG_START_EVENTS.has(type)
    ? window.removeEventListener(type, handler, asCapture(options))
    : document.removeEventListener(type, handler, options)),
}

// A mouse press starts a drag at once; only a finger waits out the hold. The
// backend sends every press through its touch delay when one is set — for a
// mouse, a zero-length timer — and a move that lands before that timer fires
// reads as "moved during the hold" and cancels the drag for the whole gesture.
// A quick hand beat the timer often enough that drags failed at random.
const PointerDragBackend = (manager, context, options) => {
  const backend = TouchBackend(manager, context, options)
  const startAfterHold = backend.handleTopMoveStartDelay
  backend.handleTopMoveStartDelay = (e) => (e.type === 'mousedown'
    ? backend.handleTopMoveStart(e)
    : startAfterHold(e))
  return backend
}

const dragOptions = {
  enableMouseEvents: true,
  rootElement: dragEventRoot,
  // A finger has to rest this long before it can drag. Moving sooner is a
  // scroll — the Open Webs list, the header strip and the panel lists are
  // scrolled by touching the very rows that drag. A mouse drags at once.
  delayTouchStart: 200,
  delayMouseStart: 0,
  // And then move this far, so a held tap (or a click) still clicks.
  touchSlop: 6,
}

const mountApp = () => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <DndProvider backend={PointerDragBackend} options={dragOptions}>
        <DragSessionGuards />
        <App />
      </DndProvider>
    </React.StrictMode>,
  )
}

if ((import.meta.env.DEV || import.meta.env.MODE === 'profile') && window.__REDSTRING_FIXTURE_MODE__) {
  // Fixture mode (dev server and the profiling build only; the perf scenarios,
  // P0.04, run on the latter): load the fixture and disable persistence before
  // the app mounts. If that fails, don't mount at all: a half-initialised
  // fixture session must never fall through to the real storage bootstrap.
  import('./dev/fixtureLoader.js')
    .then((m) => m.bootFixtureMode(window.__REDSTRING_FIXTURE_MODE__.name))
    .then(mountApp)
    .catch((err) => {
      console.error('[fixture] boot failed; app not mounted', err)
      window.__fixtureError = String(err?.message || err)
      const root = document.getElementById('root')
      root.textContent = `Fixture boot failed: ${window.__fixtureError}`
      root.setAttribute('data-fixture-error', 'true')
    })
} else {
  mountApp()
}
