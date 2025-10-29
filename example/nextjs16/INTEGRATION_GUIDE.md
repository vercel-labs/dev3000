# dev3000 Integration Guide

This guide shows you how to integrate dev3000 into your own Next.js project using git submodules.

## Quick Start

### 1. Add dev3000 as a git submodule

Navigate to your project's frontend directory and add dev3000 as a submodule:

```bash
cd /path/to/your-project/frontend
git submodule add https://github.com/automationjp/dev3000 .dev3000
```

### 2. For WSL2: Disable symlinks (workaround for Windows path length limits)

```bash
cd .dev3000
git config core.symlinks false
git checkout -f
cd ..
```

### 3. Copy required files from reference directory

All reference files are located in `.dev3000/example/nextjs16/reference/`:

```bash
# Copy entrypoint script
mkdir -p scripts
cp .dev3000/example/nextjs16/reference/scripts/docker-entrypoint.sh scripts/

# Copy Docker configuration
cp .dev3000/example/nextjs16/reference/Dockerfile.dev ./

# Copy docker-compose and Makefile to project root
cp .dev3000/example/nextjs16/reference/docker-compose.yml ../
cp .dev3000/example/nextjs16/reference/Makefile ../
```

### 4. Build and start from project root

```bash
cd ..  # Go to project root
make dev-rebuild
make dev-up
```

That's it! Your project structure should now look like this:

```
/your-project/                  # Your project root
├── frontend/                   # Your Next.js application
│   ├── .dev3000/              # dev3000 repository (git submodule)
│   │   ├── src/               # dev3000 source code
│   │   ├── mcp-server/        # MCP server source
│   │   └── example/
│   │       └── nextjs16/
│   │           └── reference/ # 🔍 Reference files for integration
│   │               ├── docker-compose.yml
│   │               ├── Makefile
│   │               ├── Dockerfile.dev
│   │               └── scripts/
│   │                   └── docker-entrypoint.sh
│   ├── app/                    # Your Next.js App Router code
│   ├── scripts/
│   │   └── docker-entrypoint.sh  # Copied from reference/
│   ├── Dockerfile.dev          # Copied from reference/
│   ├── package.json
│   └── next.config.js
├── docker-compose.yml          # Copied from reference/
└── Makefile                    # Copied from reference/
```

## Important Prerequisites

**CDP Browser is Required**: dev3000 MCP tools (like `execute_browser_action`, `fix_my_app`, etc.) use Chrome DevTools Protocol (CDP) to control the browser. Without a CDP-enabled browser running, these tools will not work.

When you run `make dev-up`, it automatically starts Chrome with CDP enabled. You can verify it's running:

```bash
curl http://localhost:9222/json/version
```

If you need to manually start the CDP browser:

**WSL2/Windows:**
```powershell
chrome.exe --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir=C:\temp\chrome-dev-profile http://localhost:3000
```

**macOS:**
```bash
open -a "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-dev-profile http://localhost:3000
```

**Linux:**
```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-dev-profile http://localhost:3000
```

## What dev3000 Provides

When running `make dev-up`:

1. **Automatic Monitoring**
   - Server logs captured
   - Browser console recorded
   - Network requests tracked
   - Screenshots on errors

2. **AI-Powered Debugging**
   - `fix my app` for analysis
   - Prioritized error reports
   - Exact fix suggestions
   - Interaction replay

3. **MCP Integration**
   - Next.js builtin MCP at `/_next/mcp`
   - dev3000 MCP at http://localhost:3684
   - CDP browser integration (required)

## Access Points

- **Your App**: http://localhost:3000
- **dev3000 UI**: http://localhost:3684

---

## Dev-up Flow (What Happens)

When you run `make dev-up`, the following occurs with log-driven diagnostics:

1. Docker containers start (Next.js app + dev3000 MCP server)
2. Next.js readiness check (up to 60s)
3. Route warming (only if Next.js is ready)
   - Warms common routes to precompile in dev: `/`, `/demos/counter`, `/demos/server-actions`, `/demos/parallel-routes`
   - Each warming logs HTTP status and elapsed time (e.g., `warmed (200) in 1s ✅`)
4. Chrome with CDP launch (cross-platform launcher)
5. CDP verification
   - Host/WSL checks are shown as reference
   - Authoritative signal is the container’s ability to reach CDP (localhost:9222 via socat)

Notes:
- On WSL2, the container starts a socat proxy so dev3000 inside the container can connect to your host Chrome via `localhost:9222`.
- Experimental turbopack filesystem cache flags are disabled on stable Next.js (only supported on latest canary).

- **Logs Viewer**: http://localhost:3684/logs
- **Chrome CDP**: http://localhost:9222/json/version

## Makefile Commands

```bash
make dev-up        # Start development environment
make dev-down      # Stop development environment
make dev-logs      # Follow container logs
make dev-rebuild   # Rebuild Docker image
make status        # Show environment status
```

## Customization

### Change Ports

Edit `docker/docker-compose.yml`:

```yaml
ports:
  - "3001:3000"   # Change 3001 to your preferred port
  - "3685:3684"   # Change 3685 to your preferred MCP port
```

### Add Environment Variables

Edit `docker/docker-compose.yml`:

```yaml
environment:
  - DATABASE_URL=postgresql://...
  - API_KEY=your-api-key
  # Add your custom variables here
```

### Exclude Files from Monitoring

Create `.dev3000ignore` in your frontend directory:

```
node_modules/
.next/
.git/
dist/
```

## Troubleshooting

### Port Conflicts

If ports 3000, 3684, or 9222 are already in use:

1. Stop the conflicting service
2. Or change ports in `docker/docker-compose.yml`

### Chrome CDP Issues

**Important**: dev3000 MCP tools require a CDP-enabled browser to be running.

1. **Check if CDP browser is running:**
   ```bash
   curl http://localhost:9222/json/version
   ```

2. **If Chrome doesn't start automatically, start it manually:**

   **WSL2/Windows:**
   ```powershell
   chrome.exe --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir=C:\temp\chrome-dev-profile http://localhost:3000
   ```

   **macOS:**
   ```bash
   open -a "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-dev-profile http://localhost:3000
   ```

   **Linux:**
   ```bash
   google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-dev-profile http://localhost:3000
   ```

3. **Symptoms of missing CDP browser:**
   - MCP tools (`execute_browser_action`, `fix_my_app`) fail with connection errors
   - Screenshots cannot be captured
   - Browser console errors not detected in logs
   - dev3000 reports "CDP not available" warnings

### Docker Build Failures

If the build fails:

```bash
make dev-rebuild  # Full rebuild without cache
```

### Permission Issues (WSL2)

If you get permission errors:

1. Ensure Docker Desktop is running
2. Check that WSL2 integration is enabled
3. Try restarting Docker Desktop

## Updating dev3000

To update dev3000 and your application to the latest version:

### Quick Update Workflow

```bash
# 1. Update dev3000 submodule to latest version
make dev3000-sync

# 2. Copy updated example app files (if using nextjs16 example)
rsync -av --exclude='node_modules' --exclude='.next' \
  frontend/.dev3000/example/nextjs16/ frontend/

# 3. Rebuild Docker image with updated code
make dev-rebuild-frontend

# 4. Start the development environment
make dev-up
```

### What each step does:

1. **`make dev3000-sync`** - Updates the dev3000 submodule in `frontend/.dev3000` to the latest version from GitHub
2. **`rsync`** - Copies updated example app files (only needed if you're using the reference example, skip if using your own app)
3. **`make dev-rebuild-frontend`** - Rebuilds the Docker image with updated dependencies and code
4. **`make dev-up`** - Starts the containers and launches Chrome with CDP

### Manual Update (Alternative)

If you prefer to update manually without make commands:

```bash
cd frontend/.dev3000
git pull origin main
cd ../..
docker compose down
docker compose build
docker compose up -d
```

## Learn More

- [dev3000 Repository](https://github.com/automationjp/dev3000)
- [Next.js 16 Documentation](https://nextjs.org/docs)
- [Model Context Protocol](https://modelcontextprotocol.io/)
