# Dev3000 Docker Image
# Multi-stage build for optimal size and security
# Base: node:20-bookworm-slim for minimal dependencies

FROM node:20-bookworm-slim AS base

# Install pnpm globally
RUN corepack enable && corepack prepare pnpm@latest --activate

# Set working directory
WORKDIR /app

# Create non-root user (node user already exists in official node image)
# Set ownership of /app to node user
RUN chown -R node:node /app

# Switch to non-root user
USER node

# Copy package files for dependency installation
# Note: This assumes dev3000 is globally installed or mounted
# For development, mount your project directory to /app

# Expose ports
# 3000: Default Next.js/app server port
# 3684: Dev3000 MCP server port
EXPOSE 3000 3684

# Health check for MCP server
# Checks if dev3000's MCP server is responding
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:3684/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))" || exit 1

# Environment variables for Docker container
ENV NODE_ENV=development \
    CHOKIDAR_USEPOLLING=true \
    WATCHPACK_POLLING=true \
    DEV3000_CDP_SKIP_LAUNCH=1

# Default command: Install dependencies and run dev3000
# This will be overridden by docker-compose.yml
CMD ["sh", "-c", "pnpm install && dev3000"]
