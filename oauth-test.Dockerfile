FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy only OAuth server files
COPY oauth-server.js ./

# Expose OAuth port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3002/health || exit 1

# Start OAuth server with debug logging for test
CMD ["node", "oauth-server.js"]
