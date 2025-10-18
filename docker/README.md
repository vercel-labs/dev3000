# Dev3000 Docker Setup

This directory contains Docker configuration for running Dev3000 with Next.js 15 in a containerized environment, with browser automation via Chrome DevTools Protocol (CDP) from the host machine.

## Architecture

```
┌────────────────────────────────────┐
│ Host (WSL/Linux/macOS/Windows)    │
│  Chrome :9222 (CDP)               │
│       ↑                            │
│       │ CDP WebSocket              │
│  ┌────┴─────────────────────┐     │
│  │ Docker Container         │     │
│  │  Dev3000 :3684           │     │
│  │    └─→ Next.js :3000     │     │
│  └──────────────────────────┘     │
└────────────────────────────────────┘
```

**Key Points:**
- Chrome runs on the **host** with `--remote-debugging-port=9222`
- Dev3000 runs **inside Docker** and connects to host Chrome via CDP
- Next.js app runs as a child process of Dev3000
- All logs, screenshots, and monitoring accessible at `http://localhost:3684`

## Quick Start

From the repository root:

```bash
# One-command startup (recommended)
npm run dev3000:up

# Or manually:
# 1. Start Chrome with CDP on host
# 2. Build and run Docker container
cd docker
docker compose up --build
```

## Files

- **Dockerfile**: Multi-stage build with node:20-bookworm-slim
  - Non-root user (`USER node`)
  - Security hardening (`cap_drop: ALL`, `no-new-privileges`)
  - Health checks for MCP server

- **docker-compose.yml**: Service orchestration
  - Port mappings: 3000 (Next.js), 3684 (MCP)
  - WSL support via `extra_hosts: host-gateway`
  - File watching enabled (`CHOKIDAR_USEPOLLING`)
  - Environment variables for external CDP

- **.dockerignore**: Build context optimization

## Platform-Specific Setup

### WSL (Windows Subsystem for Linux)

```bash
# Chrome will be launched on Windows, accessible from WSL via host.docker.internal
npm run dev3000:up
```

**WSL Notes:**
- The automation script `tools/dev3000-up.mjs` automatically detects WSL
- Windows Chrome is preferred (Snap/Flatpak restrictions)
- CDP URL uses `host.docker.internal` for cross-boundary communication

### macOS

```bash
npm run dev3000:up
```

**macOS Notes:**
- Uses `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- `host.docker.internal` works natively on Docker Desktop for Mac

### Linux

```bash
npm run dev3000:up
```

**Linux Notes:**
- Requires Docker 20.10+ for `host-gateway` support
- Avoids Snap/Flatpak Chrome (CDP restrictions)
- Falls back to system Chrome if available

## Manual Setup (Without Automation Script)

### 1. Start Chrome with CDP

**macOS/Linux:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-dev-profile \
  --no-first-run \
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

### 2. Get CDP WebSocket URL

```bash
curl http://localhost:9222/json | jq -r '.[0].webSocketDebuggerUrl'
```

Example output:
```
ws://localhost:9222/devtools/browser/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

### 3. Set Environment Variable and Start Docker

```bash
export DEV3000_CDP_URL="ws://host.docker.internal:9222/devtools/browser/..."
cd docker
docker compose up --build
```

### 4. Access Services

- **Next.js App**: http://localhost:3000
- **Dev3000 UI**: http://localhost:3684
- **Logs Viewer**: http://localhost:3684/logs
- **Screenshots**: http://localhost:3684/screenshots

## Environment Variables

### Required for External CDP

- `DEV3000_CDP_SKIP_LAUNCH=1` - Skip launching Chrome inside container
- `DEV3000_CDP_URL` - WebSocket URL from host Chrome

### File Watching (Auto-configured)

- `CHOKIDAR_USEPOLLING=true` - Enable polling for file changes
- `WATCHPACK_POLLING=true` - Enable polling for webpack/turbopack

### Optional

- `NEXT_TELEMETRY_DISABLED=1` - Disable Next.js telemetry
- `NODE_ENV=development` - Node environment

## Troubleshooting

### CDP Connection Failed

**Symptom**: `Failed to connect to CDP` in logs

**Solutions**:
1. Verify Chrome is running with CDP:
   ```bash
   curl http://localhost:9222/json
   ```

2. Check `DEV3000_CDP_URL` is set correctly:
   ```bash
   echo $DEV3000_CDP_URL
   ```

3. For WSL, ensure `host.docker.internal` resolves:
   ```bash
   docker exec dev3000 ping host.docker.internal
   ```

### Port Already in Use

**Symptom**: `Port 3000 already allocated`

**Solutions**:
```bash
# Check what's using the port
lsof -ti:3000 | xargs kill -9

# Or use different ports
docker compose up -p 5173:3000
```

### Hot Reload Not Working

**Symptom**: Changes don't trigger rebuild

**Solutions**:
1. Verify polling is enabled:
   ```bash
   docker exec dev3000 env | grep POLLING
   ```

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

### Snap/Flatpak Chrome Issues

**Symptom**: CDP not accessible from Docker

**Solution**: Use non-Snap Chrome or Windows Chrome (WSL)

```bash
# Remove Snap Chrome (Ubuntu)
sudo snap remove chromium

# Install .deb Chrome
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i google-chrome-stable_current_amd64.deb
```

## Development Workflow

1. **Start Dev Environment**:
   ```bash
   npm run dev3000:up
   ```

2. **Make Code Changes** in `example/nextjs15/`
   - Changes auto-detected via polling
   - Next.js hot-reloads automatically

3. **View Logs & Screenshots**:
   - Browser: http://localhost:3684/logs
   - Screenshots: Auto-captured on errors/navigation

4. **Use Claude for Debugging**:
   - Claude has access to dev3000 MCP tools
   - Run `fix my app` for AI-powered debugging

5. **Stop Environment**:
   ```bash
   npm run dev3000:down
   ```

## Security Considerations

### Included Protections

- ✅ Non-root user (`USER node`)
- ✅ Dropped all capabilities (`cap_drop: ALL`)
- ✅ No privilege escalation (`no-new-privileges:true`)
- ✅ Health checks for monitoring
- ✅ Resource limits (CPU/memory)

### CDP Security Warning

⚠️ **CDP Port (9222) has no authentication** - only use for development:
- Do NOT expose port 9222 to external networks
- Do NOT use in production environments
- CDP provides full browser control to anyone with access

### Recommended for Production

For production, use standard Next.js deployment without dev3000:
```bash
npm run build
npm run start
```

## Resource Limits

Default limits (configurable in docker-compose.yml):
- **CPU**: 2 cores max, 0.5 cores reserved
- **Memory**: 4GB max, 512MB reserved

Adjust based on your project size:
```yaml
deploy:
  resources:
    limits:
      cpus: '4.0'
      memory: 8G
```

## Next Steps

- See [DOCKER_SETUP.md](../DOCKER_SETUP.md) for comprehensive setup guide
- See [README.md](../README.md) for dev3000 general usage
- See [example/nextjs15/README.md](../example/nextjs15/README.md) for Next.js example

## Support

For issues specific to Docker setup, check:
1. Docker version (`docker --version`) - requires 20.10+
2. Docker Compose version (`docker compose version`) - requires 1.29+
3. Platform detection in `tools/dev3000-up.mjs`
