# Local Development Setup

## Quick Start (Full Stack)

### Option 1: Docker Compose (Recommended)
```bash
# Start everything at once
docker-compose -f deployment/docker/docker-compose.yml up

# Or run in background
docker-compose -f deployment/docker/docker-compose.yml up -d
```

### Option 2: Manual Setup (3 terminals)

**Terminal 1: Frontend Dev Server**
```bash
npm run dev
# Serves React app on http://localhost:5173
```

**Terminal 2: OAuth Server**
```bash
node oauth-server.js
# OAuth server on http://localhost:3002
```

**Terminal 3: Main Server**
```bash
node deployment/app-semantic-server.js
# Main server on http://localhost:4000
```

## Testing GitHub Federation Locally

### 1. Set Environment Variables
Create `.env` file:
```bash
# GitHub OAuth (for local testing)
GITHUB_CLIENT_ID=your_oauth_client_id
GITHUB_CLIENT_SECRET=your_oauth_client_secret

# GitHub App (for production features)
GITHUB_APP_ID=YOUR_APP_ID
GITHUB_APP_CLIENT_ID=YOUR_CLIENT_ID
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...your private key...
-----END RSA PRIVATE KEY-----"
```

### 2. Test GitHub Federation Endpoints

**Test OAuth Health:**
```bash
curl http://localhost:3002/health
curl http://localhost:4000/api/github/oauth/client-id
```

**Test GitHub App Endpoints:**
```bash
# Test through main server proxy (how frontend calls it)
curl -X POST http://localhost:4000/api/github/app/create-repository \
  -H "Content-Type: application/json" \
  -d '{"installation_id":"83404431","name":"test-repo"}'

# Test OAuth server directly
curl -X POST http://localhost:3002/api/github/app/create-repository \
  -H "Content-Type: application/json" \
  -d '{"installation_id":"83404431","name":"test-repo"}'
```

### 3. Debug Network Issues

**Check OAuth server connectivity:**
```bash
# From main server container/process
curl http://localhost:3002/health
```

**Check proxy routing:**
```bash
# Main server should proxy to OAuth server
curl http://localhost:4000/api/github/oauth/health
```

## Architecture

```
Frontend (5173) → Main Server (4000) → OAuth Server (3002) → GitHub API
     ↓                  ↓                    ↓
   React App       Proxy + Static      GitHub OAuth/App
                   File Server         Authentication
```

## Common Issues

### "OAuth service unavailable" Error
- Check if OAuth server is running on port 3002
- Verify main server can reach `http://localhost:3002`
- Check firewall/network connectivity

### 404 Endpoint Not Found
- Make sure both servers have the latest code
- Verify proxy routes exist in `deployment/app-semantic-server.js`
- Check OAuth server has the actual endpoint in `oauth-server.js`

### Environment Variables
- OAuth server needs GitHub credentials to work
- Main server needs to know OAuth server URL (default: localhost:3002)

## Quick Debug Commands

```bash
# Check if servers are running
lsof -i :3002  # OAuth server
lsof -i :4000  # Main server  
lsof -i :5173  # Frontend dev server

# Test connectivity
curl http://localhost:3002/health
curl http://localhost:4000/health
curl http://localhost:4000/api/github/oauth/health

# Check logs
# (servers will output logs to terminal when run manually)
```