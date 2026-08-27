---
compendium_version: 1
category: dev-ops
last_reviewed: 2026-08-27
---

# Development Operations — Document Index

## Summary

These documents cover testing setup, the NodeCanvas refactoring work (Oct 2025), pre-release audit, onboarding flow fixes, and miscellaneous UI improvements. Most documents here are historical — they describe work that was completed and is now reflected in the codebase. The only actively-used operational document is `../documentation/dev-ops/TESTING_ONBOARDING.md`. Key code paths: `test/`, `src/NodeCanvas.jsx` (post-refactor), `src/components/AlphaOnboardingModal.jsx`.

---

## Current Documents

| File | Summary | Key for |
|------|---------|---------|
| [TESTING_ONBOARDING.md](../documentation/dev-ops/TESTING_ONBOARDING.md) | How to use the `?testing=true` URL parameter to bypass onboarding in tests; test mode behavior | Writing or running automated tests that need to skip the onboarding flow |

---

## Historical Documents

| File | Summary | Consult when |
|------|---------|--------------|
| [PRE_RELEASE_AUDIT.md](../documentation/dev-ops/PRE_RELEASE_AUDIT.md) | Open-source prep checklist: secrets removal, license headers, dependency audit — most items completed | Preparing another open-source release; checking what was cleaned up |
| [.refactor-inventory.md](../.refactor-inventory.md) | NodeCanvas baseline metrics before Oct 2025 refactor: line count, function count, cyclomatic complexity | Understanding the scale of NodeCanvas before the refactor; baseline for regression comparison |
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
