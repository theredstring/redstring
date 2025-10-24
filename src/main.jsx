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
        enableMouseEvents: true,
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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <DndProvider backend={MultiBackend} options={HTML5toTouch}>
      <App />
    </DndProvider>
  </React.StrictMode>,
)
