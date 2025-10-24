# 🚀 Redstring Deployment Guide

## Quick Start

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

## 🔐 Multi-Client OAuth Setup

### Why Multi-Client OAuth?
- **No .env changes** needed for new clients
- **Dynamic registration** at runtime
- **Multiple environments** (dev, staging, prod) with different OAuth apps
- **Isolation** between different deployments

### Setup Process

1. **Start the Multi-Client OAuth Server**
```bash
npm run oauth:multi
```

2. **Register OAuth Clients**
```bash
# Interactive registration
npm run oauth:register

# Or register multiple clients
npm run oauth:register  # Client 1
npm run oauth:register  # Client 2
npm run oauth:register  # Client 3
```

3. **Use Internal Client IDs in Frontend**
Each registered client gets an `internalId` that your frontend uses instead of hardcoded client IDs.

### Example Registration
```bash
$ npm run oauth:register

🔐 OAuth Client Registration
===============================

Enter client name: Production App
Enter GitHub OAuth Client ID: abc123def456
Enter GitHub OAuth Client Secret: secret789xyz
Enter domain: myapp.com

✅ Client registered successfully!
==================================
Client Name: Production App
Internal ID: 550e8400-e29b-41d4-a716-446655440000
Client ID: abc123def456

📋 Usage:
Use Internal ID "550e8400-e29b-41d4-a716-446655440000" in your frontend
```

## 🐳 Docker Deployment

### Single Container
```bash
docker build -t redstring .
docker run -p 4000:4000 -p 3002:3002 redstring
```

### Docker Compose (Production)
```bash
docker-compose up -d
```

### Environment Variables
```bash
# Optional overrides
PORT=4000                    # Main server port
OAUTH_PORT=3002             # OAuth server port
NODE_ENV=production         # Production mode
```

## 🌐 Hosting Options

### 1. **VPS/Cloud Server**
- Deploy with Docker on any VPS
- Use nginx reverse proxy
- SSL with Let's Encrypt

### 2. **Container Platforms**
- **Heroku**: Deploy with `heroku.yml`
- **Railway**: Direct Git deployment
- **Render**: Docker deployment
- **DigitalOcean App Platform**

### 3. **Kubernetes**
- Use provided `k8s/` manifests
- Horizontal pod autoscaling
- Load balancing

## 🔧 Production Configuration

### Nginx Reverse Proxy
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    # Main app
    location / {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    # OAuth endpoints
    location /api/clients/ {
        proxy_pass http://localhost:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Health Checks
- Main app: `GET http://localhost:4000/health`
- OAuth server: `GET http://localhost:3002/health`

## 🔍 Monitoring

### Client Management
```bash
# List all registered clients
curl http://localhost:3002/api/clients

# Check OAuth server health
curl http://localhost:3002/health

# Deactivate a client
curl -X DELETE http://localhost:3002/api/clients/{internalId}
```

### Logs
```bash
# Docker logs
docker logs <container-id>

# Local logs
npm run oauth:multi | tee oauth.log
npm run server | tee server.log
```

## 🛡️ Security Best Practices

1. **Client Secrets**: Never expose in frontend code
2. **HTTPS**: Always use SSL in production  
3. **Rate Limiting**: Implement on OAuth endpoints
4. **Client Isolation**: Each client gets unique internal ID
5. **Rotation**: Regularly rotate OAuth client secrets

## 📊 Scaling

### Horizontal Scaling
- OAuth server is stateless (with Redis backend)
- Multiple app instances behind load balancer
- Session affinity not required

### Database Integration
Replace in-memory client store with:
- **Redis** for session storage
- **PostgreSQL** for persistent client data
- **MongoDB** for document-based storage

## 🆘 Troubleshooting

### Common Issues
1. **Port conflicts**: Change `PORT` and `OAUTH_PORT`
2. **Client not found**: Check `internalId` in frontend
3. **CORS errors**: Update OAuth server origins
4. **GitHub API limits**: Monitor rate limits per client

### Debug Mode
```bash
# Enable debug logging
DEBUG=oauth:* npm run oauth:multi
```

## 🔄 Updates & Maintenance

### Zero-Downtime Updates
1. Build new container
2. Start new instance on different port
3. Update load balancer
4. Stop old instance

### Client Migration
Clients can be migrated between OAuth servers using the registration API.

---

**Ready to deploy? Start with `npm run prod:docker` for the easiest setup! 🚀**