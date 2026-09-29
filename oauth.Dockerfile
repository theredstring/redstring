FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy only OAuth server files
COPY oauth-server.js ./

# Expose port (Cloud Run uses PORT env var, defaults to 3002 locally)
EXPOSE 8080

# Health check (use PORT env var or default to 3002)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3002}/health || exit 1

# oauth-server.js binds loopback by default; this container must accept
# traffic from the Cloud Run front end (explicit cloud entrypoint).
ENV OAUTH_BIND_HOST=0.0.0.0

# Start OAuth server
CMD ["node", "oauth-server.js"]
