---
compendium_version: 1
category: storage-federation
last_reviewed: 2026-06-13
---

# Storage, Sync, and Federation — Document Index

## Summary

These documents cover local development setup, deployment environments (GCP Cloud Run, Cloudflare Pages, Electron, Docker), OAuth and GitHub App configuration, universe management, and the analytics system. The deployment setup has three target environments: **GCP Cloud Run** (primary production), **Cloudflare Pages** (staging), and **Electron** (desktop app). Key code paths: `src/services/SaveCoordinator.js`, `src/services/universeBackend.js`, `src/services/gitNativeFederation.js`, `src/services/fileHandlePersistence.js`, `electron/main.cjs`, `deployment/`.

---

## Current Documents

### Setup and Local Development

| File | Summary | Key for |
|------|---------|---------|
| [SETUP.md](../SETUP.md) | Basic local setup: prerequisites, environment variables, `npm install`, `npm run dev` | Getting started on local development |
| [LOCAL_DEVELOPMENT.md](../LOCAL_DEVELOPMENT.md) | Docker Compose and manual local setup; service dependencies | Full local stack with all services |
| [LOCAL_DOCKER_SETUP.md](../LOCAL_DOCKER_SETUP.md) | Docker-specific setup guide; container config | Docker-first development workflow |
| [LOCAL_LLM_SETUP.md](../LOCAL_LLM_SETUP.md) | Setting up local LLMs via Ollama as an alternative to remote AI providers | Offline / BYOK local model setup |
| [ELECTRON_SETUP.md](../ELECTRON_SETUP.md) | Building Redstring as an Electron desktop app: native file access, IPC setup, packaging | Desktop app builds and distribution |
| [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) | Common issues and their resolutions; MCP-specific troubleshooting | Diagnosing environment and configuration problems |
| [SECURITY.md](../SECURITY.md) | Security policy and vulnerability reporting procedures | Security disclosures |

### Deployment

| File | Summary | Key for |
|------|---------|---------|
| [DEPLOYMENT.md](../DEPLOYMENT.md) | GCP Cloud Run deployment for production and test environments: build, push, deploy commands, environment isolation | Production deployments |
| [DEPLOYMENT_QUICK_START.md](../DEPLOYMENT_QUICK_START.md) | Quick-reference card for common deployment operations | Day-to-day deploy tasks |
| [PRODUCTION-SETUP.md](../PRODUCTION-SETUP.md) | Production environment setup checklist: secrets, environment variables, health checks | First-time production configuration |
| [deployment/README.md](../deployment/README.md) | Overview of the `deployment/` folder structure | Navigating deployment configs |
| [deployment/DEPLOYMENT.md](../deployment/DEPLOYMENT.md) | Detailed deployment guide (more verbose than root `DEPLOYMENT.md`) | Deep-dive on deployment steps |
| [deployment/SIMPLE_DEPLOYMENT.md](../deployment/SIMPLE_DEPLOYMENT.md) | Simplified self-hosted deployment without managed OAuth | Self-hosting without Google Cloud |
| [deployment/CLOUD_RUN_CPU_VALUES.md](../deployment/CLOUD_RUN_CPU_VALUES.md) | GCP Cloud Run CPU and memory configuration reference values | Tuning Cloud Run instance sizing |
| [cloudflare/README.md](../cloudflare/README.md) | Cloudflare Pages staging stack with serverless functions (Pages Functions) | Staging environment on Cloudflare |

### Auth and GitHub Integration

| File | Summary | Key for |
|------|---------|---------|
| [GITHUB_APP_SETUP.md](../GITHUB_APP_SETUP.md) | GitHub App creation, permissions, webhook configuration, and installation | Setting up Git-backed universe federation |
| [setup-oauth.md](../setup-oauth.md) | OAuth setup guide for the authentication flow | Configuring user authentication |

### Analytics

| File | Summary | Key for |
|------|---------|---------|
| [USER_ANALYTICS.md](../USER_ANALYTICS.md) | Analytics and session tracking system: what is tracked, how, privacy considerations | Understanding or modifying analytics |

---

## Historical Documents

| File | Summary | Consult when |
|------|---------|--------------|
| [UNIFIED_REPO_INTERFACE_SUMMARY.md](../UNIFIED_REPO_INTERFACE_SUMMARY.md) | Documents auto-create universe flow added to `RepositorySelectionModal` | Debugging auto-create flow; understanding the modal's state machine |
| [IMPORT_OPTIONS_UPDATE.md](../IMPORT_OPTIONS_UPDATE.md) | Documents new-universe-from-file option added to `GitNativeFederation` | Understanding import paths from the UI |
