# Dev3000 Docker Image
# Optimized Alpine-based image for minimal size and maximum efficiency
# Base: node:20-alpine for minimal footprint

FROM node:20-alpine AS base

# Install system dependencies required by dev3000
# lsof: Port checking utility
# coreutils: GNU coreutils for env -S support (required by dev3000 shebang)
RUN echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Installing system dependencies..." \
    && apk add --no-cache lsof curl coreutils \
    && echo "[$(date +%Y-%m-%d\ %H:%M:%S)] System dependencies installed successfully"

# Ensure GNU coreutils binaries are prioritized over BusyBox
# This is critical for dev3000's shebang (#!/usr/bin/env -S node)
ENV PATH="/usr/bin:$PATH"

# Install pnpm globally (as root)
RUN echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Enabling pnpm via corepack..." \
    && corepack enable \
    && corepack prepare pnpm@latest --activate \
    && echo "[$(date +%Y-%m-%d\ %H:%M:%S)] pnpm enabled successfully"

# Build dev3000 and MCP server from local source
WORKDIR /build/dev3000

# Copy workspace configuration and package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./

# Copy source code
COPY src ./src
COPY mcp-server ./mcp-server

# Install dependencies and build
RUN echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Installing dev3000 dependencies..." \
    && pnpm install --frozen-lockfile \
    && echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Building dev3000 CLI..." \
    && pnpm run build \
    && echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Building MCP server..." \
    && cd mcp-server && pnpm run build && cd .. \
    && echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Creating MCP server public directories..." \
    && mkdir -p /build/dev3000/mcp-server/public/screenshots \
    && chmod -R 777 /build/dev3000/mcp-server/public \
    && echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Installing dev3000 globally..." \
    && npm install -g . \
    && echo "[$(date +%Y-%m-%d\ %H:%M:%S)] dev3000 installed successfully"

# Set working directory for app
WORKDIR /app

# Copy frontend app files
COPY frontend/package*.json ./

# Create non-root user (node user already exists in Alpine node image)
# Set ownership of /app to node user
RUN chown -R node:node /app

# Switch to node user
USER node

# Install application dependencies as node user
RUN echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Installing application dependencies as node user..." \
    && npm install \
    && echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Application dependencies installed successfully" \
    && echo "Total packages: $(ls node_modules 2>/dev/null | wc -l)"

# Set PATH to include global npm packages for node user
ENV PATH="/usr/local/lib/node_modules/.bin:${PATH}"

# Copy rest of application files (will be overridden by volume mount in dev mode)
COPY --chown=node:node frontend/ ./

# Expose ports
# 3000: Default Next.js/app server port
# 3684: Dev3000 MCP server port
EXPOSE 3000 3684

# Health check for both app and MCP server
# Uses HTTP requests with fallback instead of relying on port checking
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ && \
      wget --no-verbose --tries=1 --spider http://localhost:3684/health || exit 1

# Environment variables for Docker container
ENV NODE_ENV=development \
    CHOKIDAR_USEPOLLING=true \
    WATCHPACK_POLLING=true \
    DEV3000_CDP_SKIP_LAUNCH=1

# Default command: Install dependencies and run dev3000
# This will be overridden by docker-compose.yml
CMD ["sh", "-c", "npm install && dev3000"]
