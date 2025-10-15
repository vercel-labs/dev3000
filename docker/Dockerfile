FROM node:20-bookworm-slim

# Install curl for health checks only (browser controlled via host-side CDP)
RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
USER node
