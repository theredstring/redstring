FROM node:18-alpine

WORKDIR /app

# Install curl for health checks
RUN apk add --no-cache curl

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy OAuth server with GitHub App support
COPY oauth-server.js ./

# Expose OAuth port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3002/health || exit 1

# oauth-server.js binds loopback by default; this container must accept
# traffic from the Cloud Run front end (explicit cloud entrypoint).
ENV OAUTH_BIND_HOST=0.0.0.0

# Start OAuth server
CMD ["node", "oauth-server.js"]
