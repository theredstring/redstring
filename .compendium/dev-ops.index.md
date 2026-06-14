---
compendium_version: 1
category: dev-ops
last_reviewed: 2026-06-13
---

# Development Operations — Document Index

## Summary

These documents cover testing setup, the NodeCanvas refactoring work (Oct 2025), pre-release audit, onboarding flow fixes, and miscellaneous UI improvements. Most documents here are historical — they describe work that was completed and is now reflected in the codebase. The only actively-used operational document is `TESTING_ONBOARDING.md`. Key code paths: `test/`, `src/NodeCanvas.jsx` (post-refactor), `src/components/AlphaOnboardingModal.jsx`.

---

## Current Documents

| File | Summary | Key for |
|------|---------|---------|
| [TESTING_ONBOARDING.md](../TESTING_ONBOARDING.md) | How to use the `?testing=true` URL parameter to bypass onboarding in tests; test mode behavior | Writing or running automated tests that need to skip the onboarding flow |

---

## Historical Documents

| File | Summary | Consult when |
|------|---------|--------------|
| [PRE_RELEASE_AUDIT.md](../PRE_RELEASE_AUDIT.md) | Open-source prep checklist: secrets removal, license headers, dependency audit — most items completed | Preparing another open-source release; checking what was cleaned up |
| [.refactor-inventory.md](../.refactor-inventory.md) | NodeCanvas baseline metrics before Oct 2025 refactor: line count, function count, cyclomatic complexity | Understanding the scale of NodeCanvas before the refactor; baseline for regression comparison |
| [.refactor-progress.md](../.refactor-progress.md) | Phase-by-phase refactor log: what was extracted, what was deferred, decisions made | Understanding why NodeCanvas is structured the way it is post-refactor |
| [.refactor-summary.md](../.refactor-summary.md) | Final results of Oct 2025 NodeCanvas refactor: extracted hooks/components list, before/after metrics | Quick summary of what the refactor produced |
| [ONBOARDING_FIXES.md](../ONBOARDING_FIXES.md) | `AlphaOnboardingModal` auto-close fix and file handle reconnection improvements | Debugging onboarding flow behavior |
| [UI_IMPROVEMENTS_SUMMARY.md](../UI_IMPROVEMENTS_SUMMARY.md) | Universe import UI refinements and `ConfirmDialog` improvements | Understanding the import and confirm dialog components |
| [ARTIFACT_REGISTRY_FIX.md](../ARTIFACT_REGISTRY_FIX.md) | GCP Artifact Registry permission fix: exact `gcloud` commands run to resolve push failures | Resolving GCP Artifact Registry authentication errors |

---

## Out-of-Scope (noted here to prevent confusion)

| File | Note |
|------|------|
| `docs/README.md` | Mintlify documentation template placeholder — contains **no Redstring content**. Ignore. |
