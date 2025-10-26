# Dev3000 Docker Setup

This directory contains Docker configuration for running dev3000 in a containerized environment.

## Quick Start

```bash
# From the docker directory
docker compose up --build
```

This will:
- Build the dev3000 Docker image with all dependencies
- Start the dev3000 container
- Expose ports 3000 (Next.js app) and 3684 (MCP server/logs viewer)

## Connecting to Host Chrome

By default, dev3000 is configured to connect to Chrome running on your host machine via Chrome DevTools Protocol (CDP). This allows dev3000 to monitor browser events without running Chrome inside the Docker container.

### Step 1: Start Chrome with Remote Debugging

**Windows (PowerShell):**
```powershell
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList "--remote-debugging-port=9222","--user-data-dir=$env:TEMP\chrome-dev-profile","--no-first-run","--no-default-browser-check"
```

**macOS:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-dev-profile \
  --no-first-run \
  --no-default-browser-check &
```

**Linux/WSL2:**
```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-dev-profile \
  --no-first-run \
  --no-default-browser-check &
```

### Step 2: Verify CDP Connection

Check that Chrome's debugging interface is accessible:

```bash
curl http://localhost:9222/json/version
```

You should see JSON output with Chrome version information.

### Step 3: Start Dev3000 Container

```bash
docker compose up
```

Dev3000 will automatically connect to Chrome at `http://host.docker.internal:9222`.

### Custom CDP URL

If Chrome is running on a different port or machine, set the `DEV3000_CDP_URL` environment variable:

```bash
# .env file
DEV3000_CDP_URL=http://192.168.1.100:9222

# Or via command line
DEV3000_CDP_URL=http://192.168.1.100:9222 docker compose up
```

## Accessing the Application

Once running:
- **Next.js App**: http://localhost:3000
- **Dev3000 Logs Viewer**: http://localhost:3684/logs

## Troubleshooting

### CDP Connection Issues

**Problem**: Dev3000 shows "CDP connection failed" errors

**Solutions**:
1. Verify Chrome is running with remote debugging:
   ```bash
   curl http://localhost:9222/json
   ```

2. Check that port 9222 is accessible from Docker:
   ```bash
   docker exec dev3000 curl http://host.docker.internal:9222/json
   ```

3. On WSL2, ensure `host.docker.internal` resolves correctly (already configured in docker-compose.yml)

4. Check Docker logs for CDP connection status:
   ```bash
   docker compose logs -f dev3000
   ```

### Port Already in Use

**Problem**: Port 3000 or 3684 already in use

**Solution**: Stop other services using these ports, or modify port mappings in docker-compose.yml:
```yaml
ports:
  - "3001:3000"  # Map host port 3001 to container port 3000
  - "3685:3684"  # Map host port 3685 to container port 3684
```

### Container Health Check Failures

**Problem**: Container keeps restarting with health check failures

**Solution**: 
1. Check logs: `docker compose logs dev3000`
2. Verify app is starting: `docker exec dev3000 curl http://localhost:3000`
3. Verify MCP server: `docker exec dev3000 curl http://localhost:3684/health`

### Permission Errors

**Problem**: Permission denied errors for screenshots or logs

This should be automatically resolved by the Dockerfile, but if issues persist:
```bash
docker exec dev3000 chmod -R 777 /build/dev3000/mcp-server/public
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Host Machine                                                │
│                                                             │
│  ┌──────────────────────────┐                              │
│  │ Chrome Browser           │                              │
│  │ --remote-debugging-port= │                              │
│  │ 9222                     │                              │
│  └───────────┬──────────────┘                              │
│              │ CDP (Chrome DevTools Protocol)              │
│              │                                             │
│  ┌───────────▼──────────────────────────────────────────┐  │
│  │ Docker Container: dev3000                           │  │
│  │                                                     │  │
│  │  ┌─────────────────────────────────────────────┐   │  │
│  │  │ dev3000 Process                            │   │  │
│  │  │ - Monitors Chrome via CDP                  │   │  │
│  │  │ - Captures browser events                  │   │  │
│  │  │ - Provides AI-powered dev tools            │   │  │
│  │  └─────────────────────────────────────────────┘   │  │
│  │                                                     │  │
│  │  ┌─────────────────────────────────────────────┐   │  │
│  │  │ Next.js App (Port 3000)                    │   │  │
│  │  │ - Your application being monitored         │   │  │
│  │  └─────────────────────────────────────────────┘   │  │
│  │                                                     │  │
│  │  ┌─────────────────────────────────────────────┐   │  │
│  │  │ MCP Server (Port 3684)                     │   │  │
│  │  │ - Logs viewer UI                           │   │  │
│  │  │ - Screenshot serving                       │   │  │
│  │  └─────────────────────────────────────────────┘   │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │ Port 3000        │ Port 3684
         ▼                  ▼
    http://localhost:3000   http://localhost:3684/logs
```

## Development

### Rebuilding the Image

```bash
docker compose up --build
```

### Viewing Logs

```bash
# Follow all logs
docker compose logs -f

# Follow dev3000 logs only
docker compose logs -f dev3000

# View last 100 lines
docker compose logs --tail=100 dev3000
```

### Accessing Container Shell

```bash
docker exec -it dev3000 sh
```

### Stopping the Container

```bash
# Stop without removing
docker compose stop

# Stop and remove
docker compose down

# Stop, remove, and remove volumes
docker compose down -v
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEV3000_CDP_URL` | `http://host.docker.internal:9222` | Chrome DevTools Protocol endpoint URL |
| `NODE_ENV` | `development` | Node.js environment mode |
| `CHOKIDAR_USEPOLLING` | `true` | Enable file watching polling (required for Docker) |
| `WATCHPACK_POLLING` | `true` | Enable webpack polling (required for Docker) |
| `NEXT_TELEMETRY_DISABLED` | `1` | Disable Next.js telemetry |
| `LOG_FILE_PATH` | `/tmp/d3k.log` | Path for dev3000 log file |

## Resource Limits

The container is configured with:
- **CPU Limit**: 2.0 cores
- **Memory Limit**: 4GB
- **CPU Reservation**: 0.5 cores
- **Memory Reservation**: 512MB

Adjust in docker-compose.yml if needed for your machine.

## Security

The container includes several security hardening measures:
- Runs as non-root user (`node`)
- `no-new-privileges` security option enabled
- All capabilities dropped with `cap_drop: ALL`
- Minimal base image (node:20-bookworm-slim)
- Only necessary dependencies installed

## Related Files

- `Dockerfile` - Multi-stage build configuration
- `docker-compose.yml` - Service orchestration and environment setup
- `../example/nextjs16/` - Example Next.js 16 application
