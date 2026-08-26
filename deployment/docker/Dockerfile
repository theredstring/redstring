FROM node:20-alpine

WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all source files
COPY . .

# Build arguments for Vite environment variables
# Point to the production URLs
ARG VITE_BRIDGE_URL=https://redstring.io
ARG VITE_OAUTH_URL=https://redstring.io

# Set environment variables for Vite build
ENV VITE_BRIDGE_URL=${VITE_BRIDGE_URL}
ENV VITE_OAUTH_URL=${VITE_OAUTH_URL}

# Build the React app with injected URLs.
#
# NODE_OPTIONS is set inline rather than as an ENV on purpose: it must apply to
# this build layer ONLY. Node sizes its default old-space heap from the memory it
# can see (~2GB here), and sourcemap generation for the main chunk peaks well
# past that — the map alone is ~12.5MB against a ~3.2MB bundle. But the runtime
# container is deployed to Cloud Run with --memory 1Gi, so a persistent
# NODE_OPTIONS would tell the server it may grow to 4GB inside a 1GB box and
# Cloud Run would OOM-kill the instance before V8 felt any pressure to collect.
RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build

# Expose ports
EXPOSE 4000 3002

# Copy and use startup script
COPY deployment/docker/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Use startup script
CMD ["/app/start.sh"]