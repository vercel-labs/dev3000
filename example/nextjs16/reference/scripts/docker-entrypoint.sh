#!/bin/sh
set -e

# Fix permissions for WSL2 mounted volumes
chmod -R u+w /app/frontend 2>/dev/null || true

# Change to working directory
cd /app/frontend || exit 1

echo "Dev3000 Container Starting..."
echo "Working directory: $(pwd)"

# Check if package.json exists
if [ ! -f package.json ]; then
  echo "Error: No package.json found in /app/frontend"
  echo "Please ensure your frontend app is properly mounted"
  exit 1
fi

# Check and install dependencies if needed
# Only check for the Next.js binary as the primary signal of successful installation
if [ ! -f node_modules/.bin/next ]; then
  echo "📦 Installing dependencies (first run)..."
  # Configure pnpm to use container temp directories
  pnpm config set store-dir /tmp/.pnpm-store
  pnpm config set cache-dir /tmp/.pnpm-cache
  # Install with config to avoid WSL2 permission issues
  # Using lockfile for reproducible builds
  pnpm install --config.package-import-method=hardlink || exit 1
  echo "✅ Dependencies installed"
else
  echo "✅ Dependencies already installed"
fi

# Remove stale lock file
rm -f /tmp/dev3000-*.lock

# ========== CDP (Chrome DevTools Protocol) Setup ==========
# Handles connection to Chrome browser for dev3000 monitoring
echo ""
echo "🔌 CDP (Chrome DevTools Protocol) Setup"

# Check if socat proxy should be enabled
if [ "${DEV3000_CDP_PROXY:-}" = "socat" ]; then
  echo "   Socat proxy enabled"

  # Detect host IP for Docker/WSL2 environments
  if [ -n "${DEV3000_CDP_HOST:-}" ]; then
    CDP_HOST="${DEV3000_CDP_HOST}"
  elif command -v host.docker.internal >/dev/null 2>&1 || getent hosts host.docker.internal >/dev/null 2>&1; then
    CDP_HOST="host.docker.internal"
  else
    # Fallback: Try to get host gateway IP
    CDP_HOST=$(ip route | awk '/default/ { print $3 }' | head -1)
    if [ -z "$CDP_HOST" ]; then
      CDP_HOST="172.17.0.1"  # Docker default gateway
    fi
  fi

  CDP_PORT="${DEV3000_CDP_PORT:-9222}"
  echo "   Target: ${CDP_HOST}:${CDP_PORT}"

  # Start socat proxy in background
  # Maps localhost:9222 inside container -> host.docker.internal:9222 on host
  # This allows dev3000 to connect to Chrome running on the host machine
  socat TCP-LISTEN:9222,fork,reuseaddr TCP:${CDP_HOST}:${CDP_PORT} &
  SOCAT_PID=$!
  echo "   Socat proxy started (PID: ${SOCAT_PID})"

  # Wait for socat to be ready
  sleep 1

  # Verify socat is running
  if ! kill -0 ${SOCAT_PID} 2>/dev/null; then
    echo "   ⚠️  Warning: Socat proxy failed to start"
  else
    echo "   ✅ Socat proxy running"
  fi

  # Set effective CDP URL to use localhost (via socat)
  DEV3000_CDP_EFFECTIVE_URL="http://localhost:${CDP_PORT}"
else
  # Direct connection mode (no proxy)
  echo "   Direct connection mode"
  DEV3000_CDP_EFFECTIVE_URL="${DEV3000_CDP_URL:-}"
fi

# Export CDP URL as environment variable (not command-line argument)
# dev3000 v0.0.107-canary does NOT support --cdp-url flag
# It reads the CDP URL from DEV3000_CDP_URL environment variable
if [ -n "${DEV3000_CDP_EFFECTIVE_URL:-}" ]; then
  export DEV3000_CDP_URL="${DEV3000_CDP_EFFECTIVE_URL}"
  echo "   Using CDP URL: ${DEV3000_CDP_URL}"
else
  echo "   No CDP URL configured (auto-detect mode)"
fi

echo ""

# Start dev3000
echo "Starting dev3000..."
exec node /usr/local/lib/dev3000/dist/cli.js "$@"
