Redstring Backend Modularization (Phase 1)

This directory introduces a modular backend boundary. Phase 1 is adapter-only: it re-exports existing service modules without behavior changes to prevent circular imports and clarify responsibilities.

Structure
- core/: shared placeholders for future constants/events/utilities
- auth/: wraps persistent authentication and auto-connect
- git/: wraps provider factory and adapters
- sync/: wraps Git sync engine and save coordinator
- universes/: temporary pass-through to UniverseManager (to be migrated in Phase 3)

Notes
- UI-facing entry points remain `src/services/universeBackend.js` and the bridge.
- Adapters are thin re-exports to avoid churn during migration.


