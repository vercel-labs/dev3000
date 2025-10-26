# dev3000 Integration Guide

This guide shows you how to integrate dev3000 into your own Next.js project.

## Quick Start

### 1. Clone dev3000 into your frontend directory

```bash
cd /path/to/your-project/frontend
git clone https://github.com/automationjp/dev3000 .dev3000
```

### 2. Copy reference files to your project root

```bash
# From your frontend directory
cd ..  # Go to project root

# Create docker directory
mkdir -p docker

# Copy reference files
cp frontend/.dev3000/frontend/docker-reference/docker-compose.yml docker/
cp frontend/.dev3000/frontend/docker-reference/Makefile ./
```

### 3. Start dev3000

```bash
# From your project root
make dev-up
```

That's it! Your project structure should now look like this:

```
/your-project/                  # Your project root
├── frontend/                   # Your Next.js application
│   ├── .dev3000/              # dev3000 repository (cloned)
│   │   ├── docker/
│   │   ├── Makefile
│   │   ├── src/
│   │   └── mcp-server/
│   ├── app/                    # Your Next.js App Router code
│   ├── package.json
│   └── next.config.js
├── docker/                     # Your docker config (copied from .dev3000)
│   └── docker-compose.yml
└── Makefile                    # Your Makefile (copied from .dev3000)
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
   - Context7 for docs
   - CDP browser access

## Access Points

- **Your App**: http://localhost:3000
- **dev3000 UI**: http://localhost:3684
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

If Chrome doesn't start automatically:

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

To update to the latest version:

```bash
cd frontend/.dev3000
git pull origin main
cd ../..
make dev-rebuild
```

## Learn More

- [dev3000 Repository](https://github.com/automationjp/dev3000)
- [Next.js 16 Documentation](https://nextjs.org/docs)
- [Model Context Protocol](https://modelcontextprotocol.io/)
