# Dev3000 Docker Image
# Optimized Alpine-based image for minimal size and maximum efficiency
# Base: node:20-alpine for minimal footprint

FROM node:20-alpine AS base

# Install system dependencies required by dev3000
# lsof: Port checking utility
# coreutils: GNU coreutils for env -S support (required by dev3000 shebang)
# Build dependencies in single layer for better caching
RUN apk add --no-cache \
    lsof \
    curl \
    coreutils \
    && rm -rf /var/cache/apk/*

# Ensure GNU coreutils binaries are prioritized over BusyBox
# This is critical for dev3000's shebang (#!/usr/bin/env -S node)
ENV PATH="/usr/bin:$PATH"

# Install pnpm globally (as root) - use specific version for consistency
RUN corepack enable \
    && corepack prepare pnpm@9.15.2 --activate

# Build stage for dev3000
FROM base AS dev3000-builder
WORKDIR /build/dev3000

# Copy workspace configuration and lock files first for better caching
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY package.json ./
COPY mcp-server/package.json ./mcp-server/

# Install all workspace dependencies (cached layer)
RUN pnpm install --frozen-lockfile --prefer-offline

# Copy source code (changes more frequently)
COPY tsconfig.json ./
COPY src ./src
COPY mcp-server ./mcp-server

# Build dev3000 CLI and MCP server
RUN pnpm run build && \
    cd mcp-server && pnpm run build && cd .. && \
    mkdir -p /build/dev3000/mcp-server/public/screenshots && \
    chmod -R 777 /build/dev3000/mcp-server/public

# Install dev3000 globally
RUN npm install -g .

# Final stage - production-ready image
FROM base AS production
WORKDIR /app

# Copy dev3000 from builder stage
COPY --from=dev3000-builder /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=dev3000-builder /usr/local/bin/dev3000 /usr/local/bin/dev3000
COPY --from=dev3000-builder /build/dev3000/mcp-server /usr/local/lib/node_modules/dev3000/mcp-server

# Copy frontend package files for dependency installation
COPY frontend/package*.json ./

# Create non-root user and set permissions
RUN chown -R node:node /app

# Switch to node user
USER node

# Install application dependencies with npm ci for faster, cleaner installs
RUN npm ci --prefer-offline --no-audit

# Set PATH to include global npm packages
ENV PATH="/usr/local/lib/node_modules/.bin:${PATH}"

# Copy rest of application files
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
