# P6: Close-out

**Goal.** Leave the codebase in a state where the next contributor, human or agent, can't accidentally rebuild the monolith.

**Exit criteria.**
- The README success criteria are met and recorded in METRICS.
- The docs describe the new architecture as current.
- Guardrails are enforced in CI.

---

### P6.01: Remove leftover flags and diagnostics
- **Change:**
  - Remove every temporary `window.__*` switch that no longer serves a purpose.
  - Keep the probe (`__renderProbe`) and `__diag`.
  - Fix stale comments: the 143 ms figure, links to plan files that no longer exist, and comments about "Phase N" from the older numbering schemes.

### P6.02: Final metrics
- **Change:**
  - Run the full scenario suite on the medium and large fixtures.
  - Fill in METRICS against the baseline.
  - Check every README success criterion.

### P6.03: Architecture documentation
- **Change:**
  - Write `documentation/core-system/CANVAS_ARCHITECTURE.md`, with status `current`. It covers:
    - the stores
    - the layers and hosts
    - the controllers
    - the command registry
    - where new features go
  - Update CLAUDE.md's "Central Components" section, which currently describes NodeCanvas as doing everything, and its "Key Files" list.
  - Update AI_COMPENDIUM and `.compendium/`:
    - this plan becomes `historical`
    - the architecture doc becomes `current`

### P6.04: Lock in the guardrails
- **Change:**
  - Set the final size budget.
  - Add render-budget assertions to CI. For example: S1 has no per-frame commits, S8 has 0 NodeCanvas commits, S10b and S11 have 0.
  - Add a CLAUDE.md rule: new canvas features go in a layer, host or controller, never in the NodeCanvas orchestrator.

### P6.05 (optional): Move `NodeCanvas.jsx` next to its layers
- **Change:**
  - `git mv src/NodeCanvas.jsx src/components/canvas/NodeCanvas.jsx`, in a single commit that does nothing else, so blame follows the rename.
  - Update the imports.
