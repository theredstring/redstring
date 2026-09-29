// Dev-only fixture sandbox (NodeCanvas refactor P0.02). MUST stay the first
// import: with ?fixture=<name> it isolates localStorage and the network before
// any app module evaluates. Inert otherwise, and compiled out of production.
import './dev/fixtureSandbox.js'
import { importLegacyOriginState } from './electronLegacyImport.js'

// Desktop app: the renderer moved from file:// to app://redstring, and
// storage is per-origin. Bring the old origin's localStorage/IndexedDB across
// BEFORE any app module evaluates (several read storage at import time).
// Resolves immediately on the web, on mobile, and after the first run.
importLegacyOriginState().finally(() => import('./bootApp.jsx'))
