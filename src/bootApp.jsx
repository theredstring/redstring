// The app itself, loaded by src/main.jsx once the desktop app's one-time
// storage migration (if any) has finished — so no module here can read
// localStorage or IndexedDB before it is in place.
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { TouchBackend } from 'react-dnd-touch-backend'
import { MultiBackend, PointerTransition, TouchTransition } from 'react-dnd-multi-backend'

// Initialize debug configuration early
import './utils/debugConfig.js'

// Canvas render diagnostics — exposes window.__diag. Inert until invoked.
import './utils/canvasDiagnostics.js'

// Initialize Pretext text measurement (sets up font-load cache invalidation)
import { initTextMeasurement } from './services/textMeasurement.js'
initTextMeasurement()

// Mouse drags go through the browser's native drag and drop; touch drags
// through the touch backend, which the native one can't serve (an emulator, or
// a phone, never fires dragstart from a finger). The backend in use switches on
// the first event of the other kind.
//
// The transitions must be the library's own { event, check } objects. A plain
// { from, to } here listened for an event named "undefined", so the switch
// never happened and touch could not drag anything. Pointer, not mousedown, for
// the way back: a tap also fires a compatibility mousedown, which would flip
// straight back to the native backend after every touch.
const HTML5toTouch = {
  backends: [
    {
      id: 'html5',
      backend: HTML5Backend,
      transition: PointerTransition
    },
    {
      id: 'touch',
      backend: TouchBackend,
      options: {
        enableMouseEvents: false,
        // A press has to rest this long before it can drag. Moving sooner is
        // a scroll — the Open Webs list, the header strip and the panel lists
        // are scrolled by touching the very rows that drag.
        delayTouchStart: 200,
        delayMouseStart: 0,
        // And then move this far, so a held tap still taps.
        touchSlop: 6
      },
      preview: true,
      transition: TouchTransition
    }
  ]
}

const mountApp = () => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <DndProvider backend={MultiBackend} options={HTML5toTouch}>
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
