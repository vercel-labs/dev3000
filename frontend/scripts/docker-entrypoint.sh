#!/bin/sh
# -----------------------------------------------------------------------------
# Dev3000 monorepo entrypoint（実運用版）
#
# 用途:
#   - このリポの example/nextjs16 を起動するための実運用向けエントリポイントです。
#
# 対になるテンプレート（外部導入時のコピー元）:
#   - example/nextjs16/reference/scripts/docker-entrypoint.sh
#     → 外部プロジェクトへコピーして使う前提で、読みやすさを優先しています。
#
# 同期ポリシー:
#   - 機能変更は原則 monorepo 側（本ファイル）と reference 側の両方に反映してください。
#   - 差分がある場合は、その理由をコメントで残してください。
#
# 同梱ポリシー (Bundling Policy):
#   - reference/ 版は npm 配布物には同梱しません（package.json の files を参照）。
#   - ユーザーは `.dev3000/.../reference/` から自身のプロジェクトへコピーして利用します。
# -----------------------------------------------------------------------------
set -e

# Fix permissions for WSL2 mounted volumes
chmod -R u+w /app/frontend 2>/dev/null || true

# Change to working directory
cd /app/frontend || exit 1

echo "Dev3000 Container Starting..."
echo "Working directory: $(pwd)"
echo "PWD check (inside entrypoint): $(pwd)"

# Quiet npm if it gets invoked indirectly by any tool
export NPM_CONFIG_LOGLEVEL=silent
export NPM_CONFIG_FUND=false
export NPM_CONFIG_AUDIT=false
export NPM_CONFIG_PROGRESS=false
export NPM_CONFIG_UPDATE_NOTIFIER=false

# Clean leftover NPX cache to avoid ENOTEMPTY cleanup warnings
if [ -d "/root/.npm/_npx" ]; then
  echo "[NPM] Cleaning leftover NPX cache at /root/.npm/_npx ..."
  rm -rf /root/.npm/_npx/* 2>/dev/null || true
  echo "[NPM] NPX cache cleaned"
fi

# Check if package.json exists (with actionable advice)
if [ ! -f package.json ]; then
  echo "Error: No package.json found in /app/frontend"
  echo "— Possible causes —"
  echo "  1) Docker build context mismatch (package.json not copied)"
  echo "  2) Bind mount hiding files (only app/ and public/ should be mounted)"
  echo "  3) Running compose from wrong directory"
  echo "— What to do —"
  echo "  • Rebuild: docker compose build --no-cache dev3000"
  echo "  • Run from repo root: docker compose up"
  echo "  • Ensure ./frontend/package.json exists in your repo"
  echo "  • On WSL2: prefer Linux filesystem over /mnt/c"
  exit 1
fi

# Preflight: verify read access to key files
if [ -f tsconfig.json ] && ! cat tsconfig.json >/dev/null 2>&1; then
  echo "[Preflight] EACCES: permission denied reading /app/frontend/tsconfig.json"
  echo "— What to do —"
  echo "  • Fix ownership on host: sudo chown -R \$(id -u):\$(id -g) frontend"
  echo "  • Remove root-owned artifacts: rm -rf frontend/node_modules frontend/.next"
  echo "  • Confirm volumes are not read-only (compose read_only: false)"
fi

# Preflight: verify write access to working directory
if ! sh -lc 'test -w /app/frontend && touch /app/frontend/.rwtest && rm -f /app/frontend/.rwtest' >/dev/null 2>&1; then
  echo "[Preflight] EACCES: cannot write to /app/frontend"
  echo "— What to do —"
  echo "  • Ensure the bind mounts (app/, public/) allow write"
  echo "  • On WSL2, move project to Linux filesystem"
  echo "  • Remove root-owned artifacts and rebuild"
fi

# Check and install dependencies if needed
# Only check for the Next.js binary as the primary signal of successful installation
if [ ! -f node_modules/.bin/next ]; then
  echo "📦 Installing dependencies (first run)..."
  # Configure pnpm to use container temp directories
  pnpm config set store-dir /tmp/.pnpm-store
  pnpm config set cache-dir /tmp/.pnpm-cache
  # Install with config to avoid WSL2 permission issues
  pnpm install --config.package-import-method=hardlink || exit 1
  echo "✅ Dependencies installed"
else
  echo "✅ Dependencies already installed"
fi

# Remove stale lock file
rm -f /tmp/dev3000-*.lock

# Optional: set up CDP proxy via socat
if [ "${DEV3000_CDP}" = "1" ] && [ "${DEV3000_CDP_PROXY:-}" = "socat" ]; then
  PROXY_LISTEN_PORT="${DEV3000_CDP_PROXY_LISTEN_PORT:-9222}"
  PROXY_TARGET_HOST="${DEV3000_CDP_PROXY_TARGET_HOST:-host.docker.internal}"
  PROXY_TARGET_PORT="${DEV3000_CDP_PROXY_TARGET_PORT:-9222}"

  echo "[CDP Proxy] Checking if Chrome is ready on ${PROXY_TARGET_HOST}:${PROXY_TARGET_PORT}..."

  # Event-driven approach: Wait for Chrome to be accessible before starting proxy
  # Monitor curl attempts and proceed when Chrome responds
  MAX_ATTEMPTS=60
  ATTEMPT=0
  CHROME_READY=0

  while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if curl -s -o /dev/null -w "%{http_code}" --max-time 1 "http://${PROXY_TARGET_HOST}:${PROXY_TARGET_PORT}/json" 2>/dev/null | grep -q "200"; then
      echo "[CDP Proxy] ✓ Chrome is ready on host"
      CHROME_READY=1
      break
    fi

    ATTEMPT=$((ATTEMPT + 1))

    # Show progress every 5 seconds
    if [ $((ATTEMPT % 5)) -eq 0 ]; then
      echo "[CDP Proxy] Waiting for Chrome... (attempt ${ATTEMPT}/${MAX_ATTEMPTS})"
    fi

    sleep 1
  done

  if [ $CHROME_READY -eq 0 ]; then
    echo "[CDP Proxy] ⚠ Chrome not detected after ${MAX_ATTEMPTS} seconds"
    echo "[CDP Proxy] Proceeding anyway - dev3000 will handle CDP connection internally"
  fi

  # Start socat proxy now that Chrome is ready (or we've timed out)
  echo "[CDP Proxy] Starting socat proxy: localhost:${PROXY_LISTEN_PORT} -> ${PROXY_TARGET_HOST}:${PROXY_TARGET_PORT}"
  nohup socat TCP-LISTEN:${PROXY_LISTEN_PORT},fork,reuseaddr TCP:${PROXY_TARGET_HOST}:${PROXY_TARGET_PORT} >/tmp/cdp-proxy.log 2>&1 &
  SOCAT_PID=$!

  # Give socat a moment to bind to port
  sleep 0.5

  # Verify socat is running
  if kill -0 $SOCAT_PID 2>/dev/null; then
    echo "[CDP Proxy] ✓ Proxy started (PID: ${SOCAT_PID})"
  else
    echo "[CDP Proxy] ⚠ Proxy may have failed to start"
    tail -n 10 /tmp/cdp-proxy.log 2>/dev/null || true
  fi

  export DEV3000_CDP_URL="http://localhost:${PROXY_LISTEN_PORT}"
  echo "[CDP Proxy] DEV3000_CDP_URL=${DEV3000_CDP_URL}"
fi

# Start dev3000
echo "Starting dev3000..."
exec node /usr/local/lib/dev3000/dist/cli.js "$@"
