# SSE and Cross-Platform Improvements

This document describes the improvements made to dev3000 for better Docker/WSL2/Windows support and real-time log streaming.

## Summary

These changes make dev3000 **production-ready** for Docker, WSL2, and Windows environments by:
- Fixing SSE real-time log streaming across different ports
- Adding proper Windows/container support (lsof error handling)
- Improving health checks with HTTP-based validation
- Adding convenient Docker management with Makefile

## Changes Made

### 1. **Real-Time Log Streaming (SSE) Cross-Origin Fix**

**Problem**: When accessing Dev3000 logs UI from a different port (e.g., viewing logs at `http://localhost:3684/logs` while the app runs on `http://localhost:3000`), SSE connections failed with 404 errors.

**Solution**: Implemented smart SSE endpoint detection in `mcp-server/app/logs/LogsClient.tsx`:

```typescript
// Auto-detect: if current port is 3000 (Next.js app), use port 3684 (Dev3000 MCP)
const getBaseUrl = () => {
  // 1. Check for explicit configuration (window.__MCP_BASE_URL__)
  if (typeof window !== 'undefined' && (window as any).__MCP_BASE_URL__) {
    return (window as any).__MCP_BASE_URL__
  }

  // 2. Auto-detect: if on port 3000, point to MCP server on port 3684
  if (typeof window !== 'undefined') {
    const currentPort = window.location.port
    if (currentPort === '3000') {
      return `http://${window.location.hostname}:3684`
    }
  }

  // 3. Default: use relative URL (same host/port)
  return ''
}
```

**Benefits**:
- ✅ Works when accessing logs from any port
- ✅ Supports explicit configuration via `window.__MCP_BASE_URL__`
- ✅ Automatic detection for common scenarios
- ✅ Backwards compatible (falls back to relative URLs)

**Files Modified**:
- `mcp-server/app/logs/LogsClient.tsx` (lines 1072-1095)

---

### 2. **SSE Data Format Fix**

**Problem**: SSE API was sending log data as arrays instead of strings, causing `parseLogEntries()` to fail on the client side.

**Solution**: Modified `mcp-server/app/api/logs/stream/route.ts` to send strings:

```typescript
// Before (incorrect):
const lines = content.split("\n")
controller.enqueue(encoder.encode(`data: ${JSON.stringify({ lines })}\n\n`))

// After (correct):
controller.enqueue(encoder.encode(`data: ${JSON.stringify({ lines: content })}\n\n`))
```

**Benefits**:
- ✅ Client-side `parseLogEntries()` receives expected string format
- ✅ Consistent data format across all SSE events (initial, rotation, truncation, newLines)
- ✅ Reduces client-side processing overhead

**Files Modified**:
- `mcp-server/app/api/logs/stream/route.ts` (lines 19-64)

---

### 3. **Windows and Container Support (lsof Error Handling)**

**Problem**: dev3000 crashed on Windows and some container environments with `spawn lsof ENOENT` errors because `lsof` command is not available.

**Solution**: Added error handlers to all `lsof` spawn calls in `src/dev-environment.ts`:

```typescript
proc.on("error", (err) => {
  // lsof not available (e.g., Windows, containers)
  this.debugLog(`lsof not available: ${err.message}`)
  resolve("") // Graceful fallback
})
```

**Locations Fixed**:
1. `isPortAvailable()` (line ~109) - Port availability check
2. `killMcpServer()` (line ~738) - MCP server cleanup
3. `checkProcessHealth()` (line ~828) - Health check lsof fallback
4. `shutdown()` killPortProcess (line ~2682) - Graceful shutdown cleanup

**Benefits**:
- ✅ No more crashes on Windows
- ✅ Works in minimal Docker containers without lsof
- ✅ Graceful degradation (uses HTTP health checks instead)
- ✅ Better error messages for debugging

**Files Modified**:
- `src/dev-environment.ts` (4 locations, lines 109, 738, 828, 2682)

---

### 4. **HTTP Health Check Improvements**

**Problem**: Health checks only verified HTTP connection, not response status codes.

**Solution**: Validate HTTP status codes and use appropriate endpoints:

```typescript
const path = name === "mcp" ? "/health" : "/"
const req = http.get({ host: "localhost", port, path }, (res) => {
  const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400
  resolve(ok)
})
```

**Benefits**:
- ✅ Only 2xx-3xx responses are considered healthy
- ✅ Uses proper `/health` endpoint for MCP server
- ✅ More accurate health status detection

**Files Modified**:
- `src/dev-environment.ts` (lines 775-780)

---

### 5. **Docker Environment Support**

**Added**: `LOG_FILE_PATH` environment variable to `docker/docker-compose.yml`:

```yaml
environment:
  # Dev3000 logging configuration
  - LOG_FILE_PATH=/tmp/d3k.log
```

**Benefits**:
- ✅ SSE API knows where to find log files in Docker containers
- ✅ Consistent with dev3000's symlink strategy (`/tmp/d3k.log`)
- ✅ Works across different container environments

**Files Modified**:
- `docker/docker-compose.yml` (line 46)

---

### 6. **Makefile for Easy Docker Management**

**Added**: `Makefile` with convenient commands:

```bash
make dev-up    # Start development environment (launches Chrome + Docker)
make dev-down  # Stop development environment
make dev-logs  # Follow container logs
make status    # Show environment status
```

**Key Features**:

1. **Automatic CDP URL Fetching and Injection**:
   ```bash
   # Fetches CDP WebSocket URL from Chrome and passes to Docker
   CDP_WS_URL=$(curl -s http://localhost:9222/json/version | grep -o '"webSocketDebuggerUrl":"[^"]*"')
   # Converts 127.0.0.1 → host.docker.internal for Docker networking
   cd docker && DEV3000_CDP_URL="$CDP_WS_URL" docker compose up -d
   ```

2. **Smart Chrome CDP Launch**:
   - ✅ Detects if Chrome already running (avoids duplicate launches)
   - ✅ WSL2: Detects host IP and launches Windows Chrome with correct URL
   - ✅ macOS/Linux: Launches local Chrome with CDP enabled
   - ✅ Waits for CDP endpoint to be ready (5-second timeout)
   - ✅ Retry logic for CDP URL fetching

3. **Comprehensive Status Checks**:
   ```bash
   make status
   # Shows:
   # - Docker container status
   # - Chrome CDP version and WebSocket URL
   # - Whether container has CDP URL configured
   ```

4. **Cross-Platform Support**:
   - ✅ WSL2: Uses Windows Chrome via powershell.exe/cmd.exe
   - ✅ macOS: Uses `open -a "Google Chrome"`
   - ✅ Linux: Uses `google-chrome` command
   - ✅ Platform-specific browser arguments

**Files Added**:
- `Makefile` (new file, ~154 lines)

---

## Testing the Improvements

### Test SSE Real-Time Updates

1. Start dev3000 with Docker:
   ```bash
   make dev-up
   ```

2. Open logs viewer in browser:
   ```
   http://localhost:3684/logs
   ```

3. Open browser DevTools (F12) > Console tab:
   ```
   Connecting to SSE: http://localhost:3684/api/logs/stream?logPath=/tmp/d3k.log (base: http://localhost:3684)
   ```

4. Check Network tab:
   - Filter by "stream"
   - Should see `api/logs/stream` with Type: `eventsource`
   - Status: `200` (pending/active)

5. Trigger activity in your app (navigate, click, etc.)
   - Logs should appear in real-time without page refresh

### Test Cross-Origin Access

1. Access logs from Next.js app port:
   ```
   http://localhost:3000/...
   ```

2. Open Dev3000 logs UI (embedded or separate tab):
   ```
   http://localhost:3684/logs
   ```

3. Verify SSE connects to correct endpoint:
   ```javascript
   // In browser console:
   console.log("Connected to:", window.location.href)
   // Should see: http://localhost:3684/api/logs/stream...
   ```

---

## Backwards Compatibility

All changes are **backwards compatible**:

- ✅ Works in non-Docker environments (local development)
- ✅ Falls back to relative URLs when auto-detection isn't needed
- ✅ Existing configurations continue to work
- ✅ No breaking changes to API or client code

---

## Future Enhancements

Potential improvements for consideration:

1. **HTTPS Support**: Auto-detect `https://` protocol for secure environments
2. **Custom Port Detection**: Support arbitrary MCP server ports via env variable
3. **Reconnection Strategy**: Exponential backoff is implemented; consider adding visual indicators
4. **Health Checks**: Add `/health` endpoint to SSE API for monitoring

---

## Files Changed Summary

| File | Lines Changed | Type | Key Changes |
|------|---------------|------|-------------|
| `src/dev-environment.ts` | +25 -2 | Modified | lsof error handling (4 locations) + HTTP health check improvements |
| `mcp-server/app/logs/LogsClient.tsx` | +24 -2 | Modified | SSE endpoint auto-detection (3-tier fallback) |
| `mcp-server/app/api/logs/stream/route.ts` | +6 -12 | Modified | SSE data format fix (strings vs arrays) |
| `docker/docker-compose.yml` | +3 | Modified | LOG_FILE_PATH environment variable |
| `Makefile` | +154 | Added | CDP URL fetching + Docker management + status checks |
| `README.md` | +24 | Modified | Docker/WSL2 setup documentation |
| `CHANGELOG-SSE-FIX.md` | +300 | Added | Comprehensive change documentation |

**Total**: 6 files modified, 2 files added

**Most Important Changes**:
1. `Makefile` - Automatic CDP URL fetching and Docker integration
2. `src/dev-environment.ts` - Windows/container compatibility (no more crashes)
3. `mcp-server/app/logs/LogsClient.tsx` - Cross-origin SSE support

---

## Credits

These improvements were developed based on real-world usage in the AI-OCR project, which required robust Docker/WSL2 support with real-time log streaming.

## License

Same as dev3000 main project.
