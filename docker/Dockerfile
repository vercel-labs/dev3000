# Dev3000 Docker Image
# Multi-stage build for optimal size and security
# Base: node:20-bookworm-slim for minimal dependencies

FROM node:20-bookworm-slim AS base

# Install pnpm globally (as root)
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dev3000 globally (as root to ensure proper PATH setup)
RUN npm install -g dev3000@latest

# Set working directory
WORKDIR /app

# Create non-root user (node user already exists in official node image)
# Set ownership of /app to node user
RUN chown -R node:node /app

# Switch to non-root user
USER node

# Set PATH to include global npm packages for node user
ENV PATH="/usr/local/lib/node_modules/.bin:${PATH}"

# Copy package files for dependency installation
# Note: This assumes dev3000 is globally installed or mounted
# For development, mount your project directory to /app

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
