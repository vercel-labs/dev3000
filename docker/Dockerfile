FROM node:20-bookworm-slim

# Install curl for health checks only (browser controlled via host-side CDP)
RUN apt-get update && apt-get install -y --no-install-recommends curl lsof \
  && rm -rf /var/lib/apt/lists/*

# Enable pnpm via corepack to match repo packageManager
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

WORKDIR /workspace
USER node
