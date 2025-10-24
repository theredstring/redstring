# GitHub App Integration Routes

## Overview

Clear, purpose-specific routes for GitHub App integration. Each route has one responsibility and is self-documenting.

## The Three Routes

### 1. Setup URL (Post-Installation)
```
POST https://redstring-test-umk552kp4q-uc.a.run.app/api/github/app/setup
```

**Purpose**: Handles the redirect after a user installs your GitHub App on their account/organization.

**When GitHub calls this**:
- User clicks "Install" on your GitHub App
- GitHub redirects here after installation completes

**Parameters received**:
- `installation_id` - The unique ID for this installation
- `setup_action` - Usually "install" or "update"
- `state` - Optional state parameter for CSRF protection

**What it does**:
- Logs the installation event
- Serves HTML page that stores installation info in sessionStorage
- Redirects user back to your app

---

### 2. OAuth Callback URL
```
GET https://redstring-test-umk552kp4q-uc.a.run.app/api/github/app/callback
```

**Purpose**: Handles OAuth authorization after user grants permissions.

**When GitHub calls this**:
- User authorizes your app to act on their behalf
- GitHub redirects here with temporary code

**Parameters received**:
- `code` - Temporary authorization code (exchange for access token)
- `state` - CSRF protection state (must match what you sent)
- Can also receive `installation_id` if combined with app installation

**What it does**:
- Logs the authorization event
- Serves HTML page that stores code/state in sessionStorage
- Frontend exchanges code for access token via `/api/github/oauth/token`
- Redirects user back to your app

---

### 3. Webhook URL
```
POST https://redstring-test-umk552kp4q-uc.a.run.app/api/github/app/webhook
```

**Purpose**: Receives events from GitHub about installations, pushes, issues, etc.

**When GitHub calls this**:
- Any event your app subscribes to (installation, push, issue, PR, etc.)
- Happens in background, not during user interaction

**Headers received**:
- `x-github-event` - Event type (e.g., "installation", "push")
- `x-hub-signature-256` - HMAC signature for verification
- `x-github-delivery` - Unique delivery ID

**What it does**:
- Proxies request to internal OAuth server (port 3002)
- OAuth server logs and processes the event
- Returns `{received: true}` to GitHub

---

## Route Architecture

```
┌─────────────────────────────────────────┐
│  GitHub                                 │
│  - Sends setup redirects                │
│  - Sends OAuth callbacks                │
│  - Sends webhook events                 │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│  Main Server (app-semantic-server.js)   │
│  Port 8080 (public)                     │
│                                         │
│  Routes:                                │
│  - /api/github/app/setup      (GET)    │
│  - /api/github/app/callback   (GET)    │
│  - /api/github/app/webhook    (POST)   │
│                                         │
│  Setup/Callback: Serve HTML             │
│  Webhook: Proxy to OAuth server ─────┐ │
└─────────────────────────────────────────┘
                                         │
                                         ▼
                       ┌─────────────────────────────┐
                       │  OAuth Server               │
                       │  Port 3002 (internal)       │
                       │                             │
                       │  - Processes webhooks       │
                       │  - Exchanges tokens         │
                       │  - Manages credentials      │
                       └─────────────────────────────┘
```

---

## GitHub App Configuration

Update your GitHub App settings at:
`https://github.com/settings/apps/[your-app-name]`

### General Settings

**Setup URL (optional)**:
```
https://redstring-test-umk552kp4q-uc.a.run.app/api/github/app/setup
```

**Callback URL**:
```
https://redstring-test-umk552kp4q-uc.a.run.app/api/github/app/callback
```

**Webhook URL**:
```
https://redstring-test-umk552kp4q-uc.a.run.app/api/github/app/webhook
```

### Why These URLs Are Better

**Before (implicit)**:
- `/oauth/callback` - What does this handle? OAuth? Apps? Both?

**After (explicit)**:
- `/api/github/app/setup` - Obviously handles app installation
- `/api/github/app/callback` - Obviously handles OAuth authorization  
- `/api/github/app/webhook` - Obviously receives webhook events

**Benefits**:
1. **Self-documenting**: Route name tells you its purpose
2. **Maintainable**: Each route can evolve independently
3. **Debuggable**: Logs are clearly labeled by route
4. **Standard**: Matches GitHub's conceptual model
5. **No magic**: No auto-detection of callback type

---

## Legacy Route

The old `/oauth/callback` route still exists for backward compatibility, but logs a warning to encourage migration to specific routes.

---

## Testing

### Test Setup URL
Install your app and check logs for:
```
[GitHub App Setup] Installation callback received
```

### Test Callback URL
Authorize your app and check logs for:
```
[GitHub App Callback] Authorization callback received
```

### Test Webhook URL
Trigger any event (push, issue, etc.) and check logs for:
```
[GitHub App Webhook] Proxying webhook event: [event-type]
```

---

## Implementation Files

- **Main server**: `deployment/app-semantic-server.js`
  - Lines 307-376: Setup, Callback, and Legacy routes
  - Lines 504-527: Webhook proxy

- **OAuth server**: `oauth-server.js`
  - Lines 1048-1091: Webhook event handler

- **Fast build**: `scripts/fast-build.sh`
  - Uses custom domain for env vars
