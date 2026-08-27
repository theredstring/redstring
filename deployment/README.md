# 🚀 Redstring Production Deployment

Complete production deployment setup for Redstring UI React.

## Structure

```
deployment/
├── README.md           # This file
├── server.js          # Production Express server  
├── DEPLOYMENT.md       # Detailed deployment guide
├── docker/             # Docker deployment
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── docker-entrypoint.sh
├── k8s/               # Kubernetes manifests
│   ├── deployment.yaml
│   ├── service.yaml
│   └── ingress.yaml
└── nginx/             # Nginx configuration
    └── redstring.conf
```

## Quick Start

### Development
```bash
npm run dev:full
```

### Production (Docker)
```bash
npm run prod:docker
```

### Production (Local)
```bash
npm run prod
```

## Simple OAuth Setup

Just set your GitHub OAuth app credentials in `.env`:

```bash
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
VITE_GITHUB_CLIENT_ID=your-github-client-id
```

## Deployment Options

### 1. Docker (Recommended)
- **Single container** with both app and OAuth server
- **Docker Compose** for orchestration  
- **Health checks** and restart policies
- **Volume mounts** for data persistence

### 2. Kubernetes
- **Horizontal pod autoscaling**
- **Load balancing** with ingress
- **ConfigMaps** for configuration
- **Secrets** for OAuth credentials

### 3. Traditional VPS
- **PM2** process management
- **Nginx** reverse proxy
- **Let's Encrypt** SSL certificates
- **Systemd** service files

### 4. Platform-as-a-Service
- **Heroku** with `heroku.yml`
- **Railway** direct Git deploy
- **Render** Docker deploy
- **Vercel** static + serverless API

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Load Balancer │    │  Redstring App  │    │  OAuth Server   │
│   (Nginx/HAProxy)│    │   (Port 4000)   │    │  (Port 3002)    │
│                 │────│                 │────│                 │
│   SSL/HTTPS     │    │  Static Assets  │    │ Client Registry │
│   Rate Limiting │    │  API Endpoints  │    │ Token Exchange  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Environment Variables

### Required
```bash
NODE_ENV=production
```

### Optional
```bash
PORT=4000                    # Main app port
OAUTH_PORT=3002             # OAuth server port
REDIS_URL=redis://localhost  # Client storage
LOG_LEVEL=info              # Logging level
```

### OAuth Client Registration
No environment variables needed! Register clients dynamically:

```bash
npm run oauth:register
```

## Monitoring & Health Checks

### Endpoints
- Main app: `GET /health`
- OAuth server: `GET /api/health`
- Client list: `GET /api/clients`

### Logs
```bash
# Docker
docker logs redstring-app
docker logs redstring-oauth

# PM2
pm2 logs redstring
pm2 logs oauth-server

# Journal (systemd)
journalctl -u redstring -f
```

## Scaling

### Horizontal Scaling
- OAuth server is **stateless** (with Redis)
- App instances behind **load balancer**
- **No session affinity** required

### Vertical Scaling
- Monitor **memory usage** (Node.js heap)
- Scale **CPU cores** for concurrent users
- **SSD storage** for faster file I/O

## Security Checklist

- [ ] **HTTPS** enabled with valid certificates
- [ ] **Rate limiting** on OAuth endpoints  
- [ ] **CORS** configured for your domains
- [ ] **Client secrets** never in frontend code
- [ ] **Firewall** rules for ports 4000, 3002
- [ ] **Regular updates** of Node.js and dependencies
- [ ] **Backup strategy** for OAuth client data

## Backup & Recovery

### OAuth Clients
```bash
# Export clients
curl http://localhost:3002/api/clients > oauth-clients-backup.json

# Import clients (manual process)
# Use npm run oauth:register for each client
```

### Application Data
- **User files** in `/app/data`
- **Configuration** in `/app/config`
- **Logs** in `/app/logs`

## Support

See `../documentation/storage-federation/DEPLOYMENT.md` for detailed deployment instructions and troubleshooting.

For issues:
1. Check health endpoints
2. Review application logs  
3. Verify OAuth client registration
4. Test network connectivity