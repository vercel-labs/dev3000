# Dev3000 Docker Image
# Multi-stage build for optimal size and security
# Base: node:20-bookworm-slim for minimal dependencies

FROM node:20-bookworm-slim AS base

# Install system dependencies required by dev3000
# lsof: Port checking utility
RUN echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Installing system dependencies..." \
    && apt-get update \
    && apt-get install -y --no-install-recommends lsof \
    && rm -rf /var/lib/apt/lists/* \
    && echo "[$(date +%Y-%m-%d\ %H:%M:%S)] System dependencies installed successfully"

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
    && echo "[$(date +%Y-%m-%d\ %H:%M:%S)] dev3000 installed successfully" \
    && dev3000 --version

# Set working directory for app
WORKDIR /app

# Copy example app files
COPY example/nextjs15/package*.json ./

# Create non-root user (node user already exists in official node image)
# Set ownership of /app to node user
RUN chown -R node:node /app

# Switch to node user
USER node

# Install application dependencies as node user
RUN echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Installing application dependencies as node user..." \
    && npm install \
    && echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Application dependencies installed successfully" \
    && echo "Total packages: $(ls node_modules | wc -l)"

# Set PATH to include global npm packages for node user
ENV PATH="/usr/local/lib/node_modules/.bin:${PATH}"

# Copy rest of application files (will be overridden by volume mount in dev mode)
COPY --chown=node:node example/nextjs15/ ./

# Expose ports
# 3000: Default Next.js/app server port
# 3684: Dev3000 MCP server port
EXPOSE 3000 3684

# Health check for both app and MCP server
# Checks if both Next.js app (3000) and dev3000 MCP server (3684) are responding
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "const to=ms=>new Promise(r=>setTimeout(r,ms));(async()=>{try{const a=await fetch('http://localhost:3000/',{cache:'no-store'});const m=await fetch('http://localhost:3684/health',{cache:'no-store'});process.exit(a.ok&&m.ok?0:1)}catch{process.exit(1)}})()" || exit 1

# Environment variables for Docker container
ENV NODE_ENV=development \
    CHOKIDAR_USEPOLLING=true \
    WATCHPACK_POLLING=true \
    DEV3000_CDP_SKIP_LAUNCH=1

# Default command: Install dependencies and run dev3000
# This will be overridden by docker-compose.yml
CMD ["sh", "-c", "pnpm install && dev3000"]
