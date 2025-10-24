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

# Build the React app with injected URLs
RUN npm run build

# Expose ports
EXPOSE 4000 3002

# Copy and use startup script
COPY deployment/docker/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Use startup script
CMD ["/app/start.sh"]