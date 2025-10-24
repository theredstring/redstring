# 🚀 Simple Redstring Deployment Guide

## Overview

Deploy Redstring with your own GitHub OAuth app - no complex multi-client setup needed!

## 🔐 OAuth Setup (One-Time)

### 1. Create GitHub OAuth App
1. Go to https://github.com/settings/developers
2. Click "New OAuth App"
3. Fill in:
   - **Application name**: `Redstring UI React`
   - **Homepage URL**: `http://localhost:4000` (or your domain)
   - **Authorization callback URL**: `http://localhost:4000/oauth/callback`
4. Copy the **Client ID** and **Client Secret**

### 2. Configure Environment
Create a `.env` file in your project root:

```bash
# Your GitHub OAuth App credentials
GITHUB_CLIENT_ID=your-github-client-id-here
GITHUB_CLIENT_SECRET=your-github-client-secret-here
VITE_GITHUB_CLIENT_ID=your-github-client-id-here

# Optional: Custom ports
PORT=4000
OAUTH_PORT=3002
```

## 🚀 Deployment Options

### Option 1: Docker (Recommended)
```bash
# Build and run with Docker
npm run prod:docker
```

### Option 2: Local Production
```bash
# Build and start production server
npm run prod
```

### Option 3: Docker Compose
```bash
# Use Docker Compose for orchestration
npm run prod:compose
```

## 🌐 Hosting Platforms

### VPS/Cloud Server
```bash
# Clone your repo
git clone https://github.com/yourusername/redstringuireact
cd redstringuireact

# Set environment variables
export GITHUB_CLIENT_ID=your-client-id
export GITHUB_CLIENT_SECRET=your-client-secret
export VITE_GITHUB_CLIENT_ID=your-client-id

# Deploy
npm install
npm run prod:docker
```

### Heroku
```bash
# Set config vars
heroku config:set GITHUB_CLIENT_ID=your-client-id
heroku config:set GITHUB_CLIENT_SECRET=your-client-secret
heroku config:set VITE_GITHUB_CLIENT_ID=your-client-id

# Deploy
git push heroku main
```

### Railway
1. Connect your GitHub repo to Railway
2. Set environment variables in Railway dashboard
3. Deploy automatically on git push

### DigitalOcean App Platform
1. Create new app from GitHub repo
2. Set environment variables in app settings
3. Use Dockerfile for deployment

## 🔧 Production Configuration

### Environment Variables
```bash
# Required
GITHUB_CLIENT_ID=abc123def456
GITHUB_CLIENT_SECRET=secret789xyz
VITE_GITHUB_CLIENT_ID=abc123def456

# Optional
NODE_ENV=production
PORT=4000
OAUTH_PORT=3002
```

### Domain Setup
Update your GitHub OAuth app callback URL to match your domain:
- Development: `http://localhost:4000/oauth/callback`
- Production: `https://yourdomain.com/oauth/callback`

### SSL/HTTPS
For production, ensure HTTPS is enabled:
- **Cloudflare**: Automatic SSL
- **Let's Encrypt**: Free SSL certificates
- **Platform SSL**: Most hosting platforms provide SSL

## 🔍 Health Checks

### Endpoints
- Main app: `GET http://localhost:4000/health`
- OAuth server: `GET http://localhost:3002/health`

### Verification
```bash
# Check if services are running
curl http://localhost:4000/health
curl http://localhost:3002/health

# Test OAuth flow
curl http://localhost:3002/api/github/oauth/client-id
```

## 📊 Monitoring

### Logs
```bash
# Docker logs
docker logs <container-name>

# PM2 logs (if using PM2)
pm2 logs redstring

# Direct logs
npm run prod 2>&1 | tee redstring.log
```

### Performance
- Monitor memory usage (Node.js heap)
- Check response times for OAuth endpoints
- Monitor GitHub API rate limits

## 🛡️ Security Best Practices

1. **Environment Variables**: Never commit secrets to code
2. **HTTPS**: Always use SSL in production
3. **Firewall**: Restrict access to ports 4000, 3002
4. **Updates**: Keep dependencies updated
5. **Backups**: Regular backups of user data

## 🆘 Troubleshooting

### Common Issues

#### OAuth not working
- Check GitHub OAuth app callback URL matches your domain
- Verify `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set
- Ensure OAuth server is running on port 3002

#### App won't start
- Check port availability (4000, 3002)
- Verify all dependencies installed (`npm install`)
- Check environment variables are set

#### Build failures
- Run `npm run build` to check for build errors
- Verify Node.js version compatibility
- Check for missing dependencies

### Debug Commands
```bash
# Check environment
env | grep GITHUB

# Test OAuth server
node oauth-server.js

# Test production server
node deployment/server.js

# Build debug
npm run build --verbose
```

## 🔄 Updates

### Zero-Downtime Updates
1. Build new version: `npm run build`
2. Start new instance on different port
3. Update load balancer to point to new instance
4. Stop old instance

### Environment Updates
1. Update environment variables
2. Restart services: `docker restart <container>`
3. Verify health checks pass

---

**That's it! Simple deployment with your own GitHub OAuth app. No complex multi-client setup needed! 🎉**