// Dev-only fixture sandbox (NodeCanvas refactor P0.02). MUST stay the first
// import: with ?fixture=<name> it isolates localStorage and the network before
// any app module evaluates. Inert otherwise, and compiled out of production.
import './dev/fixtureSandbox.js'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { TouchBackend } from 'react-dnd-touch-backend'
import { MultiBackend } from 'react-dnd-multi-backend'

// Initialize debug configuration early
import './utils/debugConfig.js'

// Canvas render diagnostics — exposes window.__diag. Inert until invoked.
import './utils/canvasDiagnostics.js'

// Initialize Pretext text measurement (sets up font-load cache invalidation)
import { initTextMeasurement } from './services/textMeasurement.js'
initTextMeasurement()

// Configure multi-backend for both mouse and touch support
const HTML5toTouch = {
  backends: [
    {
      id: 'html5',
      backend: HTML5Backend,
      transition: {
        from: 'mouse',
        to: 'touch'
      }
    },
    {
      id: 'touch',
      backend: TouchBackend,
      options: {
        enableMouseEvents: false,
        delayTouchStart: 100,
        delayMouseStart: 0
      },
      preview: true,
      transition: {
        from: 'touch',
        to: 'mouse'
      }
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

if (import.meta.env.DEV && window.__REDSTRING_FIXTURE_MODE__) {
  // Fixture mode (dev only): load the fixture and disable persistence before
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
