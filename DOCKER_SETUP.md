# Docker Setup Guide for Dev3000 + Next.js 15

Complete guide for running Dev3000 with Next.js 15 in Docker, with browser automation via Chrome DevTools Protocol (CDP) from the host machine.

## Table of Contents

- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Platform-Specific Setup](#platform-specific-setup)
- [Manual Setup](#manual-setup)
- [Configuration](#configuration)
- [Development Workflow](#development-workflow)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Advanced Usage](#advanced-usage)

## Architecture

### Overview

```
┌──────────────────────────────────────────────────┐
│ Host Machine (WSL/Linux/macOS/Windows)          │
│                                                  │
│  ┌─────────────────────┐                        │
│  │ Chrome Browser      │                        │
│  │ Port: 9222 (CDP)    │                        │
│  │ Profile: /tmp/...   │                        │
│  └──────────┬──────────┘                        │
│             │                                    │
│             │ CDP WebSocket (ws://)              │
│             │                                    │
│  ┌──────────▼──────────────────────────────────┐│
│  │ Docker Container: dev3000                   ││
│  │                                              ││
│  │  ┌──────────────────────────────────┐       ││
│  │  │ Dev3000 Process                  │       ││
│  │  │ - MCP Server :3684               │       ││
│  │  │ - Log monitoring                 │       ││
│  │  │ - Screenshot capture             │       ││
│  │  │                                  │       ││
│  │  │   ┌──────────────────────┐       │       ││
│  │  │   │ Next.js Dev Server   │       │       ││
│  │  │   │ Port: 3000           │       │       ││
│  │  │   │ Turbopack enabled    │       │       ││
│  │  │   └──────────────────────┘       │       ││
│  │  └──────────────────────────────────┘       ││
│  │                                              ││
│  │  Volumes:                                    ││
│  │  - example/nextjs15 → /app                  ││
│  │  - node_modules (anonymous)                  ││
│  │  - .next (anonymous)                         ││
│  └──────────────────────────────────────────────┘│
│                                                  │
│  Exposed Ports:                                  │
│  - 3000 → Next.js App                           │
│  - 3684 → Dev3000 MCP Server                    │
└──────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Chrome on Host**: Browser runs on host for stability and native performance
2. **Single Container**: Dev3000 and Next.js in one container for simplicity
3. **Volume Mounts**: Source code mounted for hot reload
4. **WSL Compatible**: Uses `host.docker.internal` for cross-boundary communication

## Quick Start

### Prerequisites

- Docker 20.10+ with Docker Compose
- Node.js 18+ (on host, for running automation scripts)
- Google Chrome installed on host
- Git (to clone the repository)

### One-Command Startup

From the dev3000 repository root:

```bash
npm run dev3000:up
```

This automated script will:
1. ✅ Detect your platform (WSL, Linux, macOS, Windows)
2. ✅ Find and launch Chrome with CDP enabled on port 9222
3. ✅ Extract the CDP WebSocket URL
4. ✅ Start Docker Compose with the correct CDP configuration
5. ✅ Build and run the dev3000 container

### Access Your App

Once running, access:
- **Next.js App**: http://localhost:3000
- **Dev3000 UI**: http://localhost:3684
- **Logs Viewer**: http://localhost:3684/logs
- **Screenshots**: http://localhost:3684/screenshots

### Shutdown

```bash
npm run dev3000:down
```

This will gracefully:
1. Stop Docker containers
2. Kill the Chrome process
3. Clean up temporary files

## Platform-Specific Setup

### WSL (Windows Subsystem for Linux)

**Recommended Setup:**

WSL provides the best of both worlds - Linux dev environment with Windows Chrome.

```bash
# From WSL terminal
cd /mnt/d/github/dev3000  # Your repository path
npm run dev3000:up
```

**How it works:**
- Chrome runs on **Windows** (better performance, no Snap/Flatpak issues)
- Dev3000 runs in **Docker via WSL**
- CDP connection via `host.docker.internal` (requires Docker Desktop with WSL2 backend)

**WSL-Specific Notes:**
- The automation script (`tools/dev3000-up.mjs`) detects WSL automatically
- Windows Chrome is prioritized: `/mnt/c/Program Files/Google/Chrome/Application/chrome.exe`
- Requires Docker Desktop for Windows with WSL2 integration enabled

**Troubleshooting WSL:**

1. **Verify Docker WSL integration:**
   ```bash
   docker version
   docker compose version
   ```

2. **Check host.docker.internal resolves:**
   ```bash
   docker run --rm alpine ping -c 1 host.docker.internal
   ```

3. **If Chrome not found:**
   - Install Chrome on Windows
   - Or use WSL Chrome: `sudo apt install google-chrome-stable`

### macOS

**Setup:**

```bash
cd ~/dev3000  # Your repository path
npm run dev3000:up
```

**How it works:**
- Chrome launched from `/Applications/Google Chrome.app/`
- Docker Desktop for Mac handles `host.docker.internal` natively
- No special configuration needed

**macOS-Specific Notes:**
- Works on both Intel and Apple Silicon
- Chrome profile stored in `/tmp/dev3000-chrome-profile`
- Requires Docker Desktop for Mac

### Linux (Native)

**Setup:**

```bash
cd ~/dev3000  # Your repository path
npm run dev3000:up
```

**How it works:**
- Uses system Chrome (avoids Snap/Flatpak for better CDP support)
- Docker 20.10+ provides `host-gateway` for `host.docker.internal`
- Standard Linux Docker installation

**Linux-Specific Notes:**
- **Avoid Snap/Flatpak Chrome** - may have CDP restrictions
- Recommended: Install Chrome via `.deb`:
  ```bash
  wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  sudo dpkg -i google-chrome-stable_current_amd64.deb
  ```
- If using Snap/Flatpak, you may see CDP connection issues

### Windows (Native)

**Setup:**

```powershell
# From PowerShell or CMD
cd C:\dev3000  # Your repository path
npm run dev3000:up
```

**How it works:**
- Chrome launched via standard Windows paths
- Docker Desktop for Windows provides `host.docker.internal`
- Scripts use Windows-specific commands (`taskkill`)

**Windows-Specific Notes:**
- Requires Docker Desktop for Windows
- Chrome typically at: `C:\Program Files\Google\Chrome\Application\chrome.exe`
- PowerShell or CMD both work

## Manual Setup

If you prefer manual control or the automation script doesn't work:

### Step 1: Launch Chrome with CDP

**macOS/Linux:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-dev-profile \
  --no-first-run \
  --no-default-browser-check \
  about:blank &
```

**Windows (PowerShell):**
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir=$env:TEMP\chrome-dev-profile `
  --no-first-run `
  about:blank
```

### Step 2: Get CDP WebSocket URL

```bash
curl http://localhost:9222/json | jq -r '.[0].webSocketDebuggerUrl'
```

Example output:
```
ws://localhost:9222/devtools/browser/abc123-def456-...
```

### Step 3: Convert URL for Docker

Replace `localhost` with `host.docker.internal`:
```
ws://host.docker.internal:9222/devtools/browser/abc123-def456-...
```

### Step 4: Start Docker with CDP URL

```bash
export DEV3000_CDP_URL="ws://host.docker.internal:9222/devtools/browser/..."
cd docker
docker compose up --build
```

### Step 5: Verify Setup

```bash
# Check MCP server health
curl http://localhost:3684/health

# Check Next.js app
curl http://localhost:3000

# View logs
docker compose logs -f dev3000
```

## Configuration

### Environment Variables

Set in `docker/docker-compose.yml` or via `export`:

#### Required for External CDP
- `DEV3000_CDP_SKIP_LAUNCH=1` - Skip launching Chrome inside container
- `DEV3000_CDP_URL` - WebSocket URL from host Chrome

#### File Watching (Pre-configured)
- `CHOKIDAR_USEPOLLING=true` - Enable polling for file changes
- `WATCHPACK_POLLING=true` - Enable webpack/turbopack polling

#### Optional
- `NEXT_TELEMETRY_DISABLED=1` - Disable Next.js telemetry
- `NODE_ENV=development` - Node environment mode

### Docker Compose Customization

Edit `docker/docker-compose.yml` to customize:

```yaml
services:
  dev3000:
    ports:
      - "5173:3000"  # Use different host port
      - "3684:3684"

    environment:
      - CUSTOM_VAR=value  # Add your env vars

    volumes:
      - ./my-app:/app  # Mount your own app instead of example

    deploy:
      resources:
        limits:
          cpus: '4.0'    # Adjust CPU limit
          memory: 8G     # Adjust memory limit
```

### Using Your Own Project

Replace the example app:

```yaml
# docker/docker-compose.yml
volumes:
  - ../my-nextjs-app:/app  # Your project path
  - /app/node_modules
  - /app/.next
```

## Development Workflow

### 1. Start Development

```bash
npm run dev3000:up
```

Wait for:
```
✅ Chrome launched with PID 12345
✅ Chrome is ready!
✅ CDP URL: ws://localhost:9222/devtools/browser/...
📦 Starting Docker environment...
```

### 2. Make Code Changes

Edit files in `example/nextjs15/pages/index.js`:

```javascript
export default function Home() {
  return <h1>Hello Dev3000!</h1>  // Auto-reloads on save
}
```

Changes are detected via file polling and trigger hot reload.

### 3. View Logs & Screenshots

**Browser UI:**
- Open http://localhost:3684/logs
- See server logs, browser events, network requests
- View automatic screenshots

**Terminal:**
```bash
docker compose logs -f dev3000
```

### 4. Debug with AI

Tell Claude:
```
fix my app
```

Dev3000's MCP tools provide:
- Complete error analysis
- Interaction replay (what user actions triggered errors)
- Code fixes with file locations
- Verification by replaying interactions

### 5. Stop Development

```bash
npm run dev3000:down
```

Or press `Ctrl+C` in the terminal running `dev3000:up`.

## Troubleshooting

### CDP Connection Issues

**Symptom:** `Failed to connect to CDP` in Docker logs

**Diagnosis:**
```bash
# Check Chrome is running with CDP
curl http://localhost:9222/json

# Check CDP URL is set
docker exec dev3000 env | grep DEV3000_CDP_URL

# Test connectivity from container
docker exec dev3000 ping host.docker.internal
```

**Solutions:**
1. Verify Chrome is running: `ps aux | grep chrome`
2. Check port 9222 is open: `lsof -i :9222`
3. Restart Chrome with correct flags
4. For WSL: Ensure Docker Desktop has WSL2 backend enabled

### Port Conflicts

**Symptom:** `Port 3000 already allocated`

**Solutions:**
```bash
# Find what's using port 3000
lsof -ti:3000

# Kill the process
lsof -ti:3000 | xargs kill -9

# Or use different ports in docker-compose.yml
ports:
  - "5173:3000"  # Map to different host port
```

### Hot Reload Not Working

**Symptom:** Changes don't trigger rebuild

**Diagnosis:**
```bash
# Check polling is enabled
docker exec dev3000 env | grep POLLING
```

Should show:
```
CHOKIDAR_USEPOLLING=true
WATCHPACK_POLLING=true
```

**Solutions:**
1. Verify environment variables are set in `docker-compose.yml`
2. Increase polling interval in `next.config.js`:
   ```javascript
   module.exports = {
     webpack: (config) => {
       config.watchOptions = {
         poll: 1000,
         aggregateTimeout: 300,
       }
       return config
     }
   }
   ```

### Docker Build Fails

**Symptom:** Build errors during `docker compose up --build`

**Solutions:**
```bash
# Clear Docker cache
docker compose build --no-cache

# Check disk space
df -h

# Check Docker daemon
docker ps
docker system df
```

### Chrome Not Found (Automation Script)

**Symptom:** `Chrome not found!` when running `npm run dev3000:up`

**Solutions:**

**macOS:**
```bash
# Install Chrome
brew install --cask google-chrome
```

**Ubuntu/Debian:**
```bash
# Install official Chrome (.deb)
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i google-chrome-stable_current_amd64.deb
```

**WSL:**
```bash
# Use Windows Chrome (preferred)
ls /mnt/c/Program\ Files/Google/Chrome/Application/chrome.exe

# Or install WSL Chrome
sudo apt install google-chrome-stable
```

### Snap/Flatpak Chrome Issues

**Symptom:** CDP not accessible, connection refused

**Root Cause:** Snap/Flatpak have sandboxing that may restrict CDP

**Solutions:**
1. **Remove Snap Chrome:**
   ```bash
   sudo snap remove chromium
   ```

2. **Install .deb Chrome:**
   ```bash
   wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
   sudo dpkg -i google-chrome-stable_current_amd64.deb
   ```

3. **Or use Windows Chrome (WSL only):**
   - Automation script prioritizes Windows Chrome on WSL

### host.docker.internal Not Resolving

**Symptom:** `ping: host.docker.internal: Name or service not known`

**Platform-Specific Solutions:**

**WSL:**
- Ensure Docker Desktop WSL2 backend is enabled
- Update Docker Desktop to latest version

**Linux:**
- Requires Docker 20.10+
- Verify `extra_hosts` in `docker-compose.yml`:
  ```yaml
  extra_hosts:
    - "host.docker.internal:host-gateway"
  ```

**Manual workaround (Linux):**
```bash
# Get host IP
ip addr show docker0 | grep inet | awk '{print $2}' | cut -d/ -f1

# Add to /etc/hosts in container
docker exec -it dev3000 sh -c 'echo "172.17.0.1 host.docker.internal" >> /etc/hosts'
```

### Understanding Detailed Error Messages

Dev3000's Docker implementation includes comprehensive error diagnostics. Each error message follows a structured format:

#### Error Message Format

```
❌ ERROR_TYPE
Field: value
Another Field: value

CAUSE: What went wrong (high-level explanation)

POSSIBLE REASONS:
  - Reason 1
  - Reason 2
  - Reason 3

DEBUG STEPS:
  1. Command to diagnose
  2. Another command
  3. How to fix

Additional Context: value
```

#### Common Error Categories

**1. Chrome Launch Errors**

**Error:** `❌ CHROME LAUNCH FAILED`

**What it means:** The automation script couldn't find or start Chrome.

**Common causes:**
- Chrome not installed
- Chrome executable not in expected location
- Using Snap/Flatpak Chrome (sandboxing issues)

**Quick fix:**
```bash
# Check if Chrome is installed
which google-chrome

# Install Chrome (Ubuntu/Debian)
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i google-chrome-stable_current_amd64.deb

# Or use custom path
dev3000 --browser /path/to/chrome
```

**2. CDP Connection Errors**

**Error:** `❌ CDP ENDPOINT UNREACHABLE` or `❌ CDP WEBSOCKET CONNECTION FAILED`

**What it means:** Container can't connect to Chrome's DevTools Protocol.

**Common causes:**
- Chrome crashed during startup
- `host.docker.internal` not resolving (Linux/WSL)
- Port 9222 blocked by firewall
- CDP URL not set correctly

**Quick fix:**
```bash
# Verify Chrome is running with CDP
curl http://localhost:9222/json

# Test from container
docker exec dev3000 curl http://host.docker.internal:9222/json

# Check environment variable
docker exec dev3000 env | grep DEV3000_CDP_URL

# For WSL: Ensure Docker Desktop WSL2 backend is enabled
```

**3. Health Check Failures**

**Error:** `❌ HEALTH CHECK FAILED - APP/MCP SERVER NOT RESPONDING`

**What it means:** A critical process (app or MCP server) stopped responding.

**Common causes:**
- Server crashed or exited
- Out of memory (OOM killer)
- Port conflict
- Build/compilation error

**Quick fix:**
```bash
# Check container health
docker ps

# View recent logs
docker compose logs --tail=50 dev3000

# Check for OOM kills
docker exec dev3000 dmesg | grep -i killed

# Check memory usage
docker stats dev3000

# Restart the container
npm run dev3000:down && npm run dev3000:up
```

**4. Port Errors**

**Error:** `❌ NO AVAILABLE PORTS FOUND`

**What it means:** All ports in the search range are occupied.

**Common causes:**
- Many services running on the system
- TIME_WAIT connections consuming ports
- lsof malfunctioning

**Quick fix:**
```bash
# See what's using ports
lsof -i -P | grep LISTEN

# Check for TIME_WAIT connections
netstat -an | grep TIME_WAIT | wc -l

# Use a specific port instead
dev3000 --port 5173

# Or edit docker-compose.yml
ports:
  - "5173:3000"
```

**5. Docker Installation Errors**

**Error:** `❌ DEV3000 INSTALLATION FAILED` or `❌ APPLICATION DEPENDENCY INSTALLATION FAILED`

**What it means:** Package installation failed inside container.

**Common causes:**
- Network connectivity issues
- npm/pnpm registry unreachable
- Disk space full
- package.json syntax error

**Quick fix:**
```bash
# Check network from container
docker exec dev3000 ping registry.npmjs.org

# Check disk space
df -h

# Clear npm cache
docker exec dev3000 pnpm store prune

# Rebuild without cache
docker compose build --no-cache

# Check package.json syntax
cat package.json | jq .
```

#### Reading Docker Logs

View detailed error output:

```bash
# Follow logs in real-time
docker compose logs -f dev3000

# View last 100 lines
docker compose logs --tail=100 dev3000

# Filter for errors only
docker compose logs dev3000 | grep "❌"

# Check specific error type
docker compose logs dev3000 | grep "CHROME LAUNCH"
```

#### Debugging Workflow

1. **Read the error message** - Look for the `CAUSE:` section
2. **Check POSSIBLE REASONS** - Identify which scenario matches
3. **Follow DEBUG STEPS** - Run the suggested commands
4. **Review logs** - Look at the full context with `docker compose logs`
5. **Test the fix** - Restart with `npm run dev3000:down && npm run dev3000:up`

#### Getting Help

When reporting issues, include:

```bash
# System information
docker --version
docker compose version
uname -a

# Full error output
docker compose logs dev3000 > error.log

# Environment configuration
docker compose config

# Network diagnostics
docker exec dev3000 ping -c 3 host.docker.internal
curl http://localhost:9222/json
```

Attach `error.log` and command outputs when creating GitHub issues.

## Security

### Included Protections

✅ **Non-root user**: Container runs as `node` user
✅ **Dropped capabilities**: `cap_drop: ALL`
✅ **No privilege escalation**: `no-new-privileges:true`
✅ **Health checks**: MCP server monitored for availability
✅ **Resource limits**: CPU and memory limits enforced
✅ **Read-only where possible**: Minimal write permissions

### CDP Security Warning

⚠️ **CRITICAL**: CDP port 9222 has **NO AUTHENTICATION**

**DO NOT:**
- ❌ Expose port 9222 to external networks
- ❌ Use in production environments
- ❌ Run on shared/untrusted networks
- ❌ Leave Chrome running unattended with CDP enabled

**WHY:** Anyone with network access to port 9222 can:
- Control your browser
- Execute JavaScript
- Access cookies and local storage
- Navigate to any URL
- Take screenshots

**Safe Usage:**
- ✅ Development environments only
- ✅ Localhost/local network only
- ✅ Stop Chrome when done: `npm run dev3000:down`

### Production Deployment

For production, use standard Next.js deployment **without dev3000**:

```bash
# Build for production
cd example/nextjs15
npm run build
npm run start

# Or deploy to Vercel, AWS, etc.
```

Dev3000 is a **development tool only**.

## Advanced Usage

### Custom App Integration

Mount your own Next.js/React/Vite app:

```yaml
# docker/docker-compose.yml
volumes:
  - /path/to/your/app:/app
  - /app/node_modules
  - /app/.next  # or /app/dist for Vite
```

Update command for your framework:
```yaml
command: >
  sh -c "
    pnpm add -g dev3000@latest &&
    dev3000 --port 3000 --script dev
  "
```

### Multi-Container Setup

Run multiple apps simultaneously:

```yaml
# docker/docker-compose.yml
services:
  dev3000-app1:
    # ... config for app 1
    ports:
      - "3000:3000"
      - "3684:3684"

  dev3000-app2:
    # ... config for app 2
    ports:
      - "3001:3000"
      - "3685:3684"
```

### Custom Chrome Flags

Modify `tools/dev3000-up.mjs` to add Chrome flags:

```javascript
const args = [
  `--remote-debugging-port=${cdpPort}`,
  '--disable-gpu',  // Add custom flags
  '--headless',     // Run headless
  // ... other flags
]
```

### Using with CI/CD

For automated testing:

```bash
# Dockerfile for CI
FROM node:20-bookworm-slim

# Install Chrome
RUN apt-get update && apt-get install -y \
    wget gnupg && \
    wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - && \
    echo "deb http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list && \
    apt-get update && apt-get install -y google-chrome-stable

# Install dev3000
RUN npm install -g pnpm && pnpm add -g dev3000

# Run Chrome in headless mode with dev3000
CMD ["sh", "-c", "google-chrome --headless --remote-debugging-port=9222 & dev3000 --port 3000"]
```

### Debugging the Automation Scripts

Enable verbose output:

```bash
# Add debug logging
NODE_DEBUG=dev3000 npm run dev3000:up
```

Or edit `tools/dev3000-up.mjs`:
```javascript
// Add more console.log statements
console.log('DEBUG:', { platform, chromePath, cdpPort })
```

## Next Steps

- See [docker/README.md](docker/README.md) for Docker-specific details
- See [example/nextjs15/README.md](example/nextjs15/README.md) for Next.js example usage
- See [README.md](README.md) for general dev3000 documentation

## Support

For issues and questions:
- GitHub Issues: https://github.com/automationjp/dev3000/issues
- Upstream (original): https://github.com/vercel-labs/dev3000
- Check [Troubleshooting](#troubleshooting) section above
- Review Docker logs: `docker compose logs -f dev3000`
