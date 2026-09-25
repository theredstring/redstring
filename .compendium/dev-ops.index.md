---
compendium_version: 1
category: dev-ops
last_reviewed: 2026-09-25
---

# Development Operations — Document Index

## Summary

These documents cover testing setup, the NodeCanvas refactoring work (Oct 2025), pre-release audit, onboarding flow fixes, and miscellaneous UI improvements. Most documents here are historical — they describe work that was completed and is now reflected in the codebase. The actively-used documents are `../documentation/dev-ops/TESTING_ONBOARDING.md` and the record of the pre-1.0 NodeCanvas refactor in `../documentation/dev-ops/nodecanvas-refactor/` (closed; the architecture it produced is in `../documentation/core-system/CANVAS_ARCHITECTURE.md`), which supersedes the Oct-2025 refactor files. Key code paths: `test/`, `src/NodeCanvas.jsx` (post-refactor), `src/components/AlphaOnboardingModal.jsx`.

---

## Current Documents

| File | Summary | Key for |
|------|---------|---------|
| [TESTING_ONBOARDING.md](../documentation/dev-ops/TESTING_ONBOARDING.md) | How to use the `?testing=true` URL parameter to bypass onboarding in tests; test mode behavior | Writing or running automated tests that need to skip the onboarding flow |

---

## Historical Documents

| File | Summary | Consult when |
|------|---------|--------------|
| [nodecanvas-refactor/README.md](../documentation/dev-ops/nodecanvas-refactor/README.md) | **The pre-1.0 NodeCanvas refactor (2026-09-23 to 09-25), closed.** Goals and success criteria, the phase board, and the folder's FINDINGS (the audit), MAP, DECISIONS, METRICS, LOG and `phases/P0–P6` cards. The resulting architecture is described, as current, in `documentation/core-system/CANVAS_ARCHITECTURE.md`. Deferred cards and their reasons are listed there and in the README | Why the canvas is shaped the way it is; picking up a deferred card (P3.05/P3.06b/P3.10/P3.11, P4.03/P4.04b/P4.05, P5.07) |
| [PRE_RELEASE_AUDIT.md](../documentation/dev-ops/PRE_RELEASE_AUDIT.md) | Open-source prep checklist: secrets removal, license headers, dependency audit — most items completed | Preparing another open-source release; checking what was cleaned up |
| [.refactor-inventory.md](../.refactor-inventory.md) | NodeCanvas baseline metrics before Oct 2025 refactor: line count, function count, cyclomatic complexity. **superseded-by:** `nodecanvas-refactor/`. The Oct-2025 plan's "Phase 2" (`useNodeActions`) was never wired in, and Phase 5 (render layers) never happened | Understanding the scale of NodeCanvas before the refactor; baseline for regression comparison |
| [.refactor-progress.md](../.refactor-progress.md) | Phase-by-phase refactor log: what was extracted, what was deferred, decisions made | Understanding why NodeCanvas is structured the way it is post-refactor |
| [.refactor-summary.md](../.refactor-summary.md) | Final results of Oct 2025 NodeCanvas refactor: extracted hooks/components list, before/after metrics | Quick summary of what the refactor produced |

> **Removed 2026-08-27** (recoverable from git history): `ONBOARDING_FIXES.md`, `UI_IMPROVEMENTS_SUMMARY.md`, `ARTIFACT_REGISTRY_FIX.md`, and `SANITIZATION_SUMMARY.md`. Each was a completion report for a one-time change — a transcript of `gcloud` commands, a checklist of a finished cleanup — with no reusable content. The code they describe is the record.

---

## Out-of-Scope (noted here to prevent confusion)

| Path | Note |
|------|------|
| `docs/` | **A separate, nested git repository, gitignored from this one.** It holds a Mintlify site (`docs/api/`, `docs/components/`, `docs/archive/` — ~45 archived fix-notes). Nothing in it is part of this repo's history and most of it is stale. The compendium references exactly two files inside it (`docs/COLLABORATION_PLAN.md`, indexed under core-system). Ignore the rest; do not grep it for current behavior. |
| `docs/README.md` | Mintlify template placeholder — contains **no Redstring content**. Ignore. |
| `CHANGELOG.md` | Gitignored and local-only (~76k lines). Not part of the repo; not indexed. |
