# dev3000 MCP Server - Cloud Deployment

This is the cloud-deployable version of the dev3000 MCP server that enables production site monitoring and error reproduction.

## Quick Start

### 1. Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/vercel-labs/dev3000&root-directory=mcp-server&project-name=dev3000-mcp-server)

Or manually:

```bash
# Link to Vercel project
vercel link

# Deploy to production
vercel --prod
```

### 2. Configure Environment Variables

Required variables (set in Vercel dashboard):

```bash
VERCEL_SANDBOX_TOKEN=<your-token>  # Get from vercel.com/account/tokens
REPO_URL=https://github.com/vercel-labs/dev3000.git
```

### 3. Test Your Deployment

```bash
# Check status
curl https://your-deployment.vercel.app/api/cloud/status

# Send test error
curl -X POST https://your-deployment.vercel.app/api/cloud/detect \
  -H "Content-Type: application/json" \
  -d '{"message":"Test","url":"https://example.com","userAgent":"test"}'
```

## Cloud API Endpoints

### Error Detection
```http
POST /api/cloud/detect
Content-Type: application/json

{
  "message": "Uncaught TypeError: Cannot read property 'foo' of undefined",
  "stack": "at Component.render (app.js:123:45)",
  "url": "https://myapp.com/checkout",
  "userAgent": "Mozilla/5.0...",
  "severity": "error",
  "interactions": ["click button", "fill form"]
}
```

### Error Reproduction
```http
POST /api/cloud/reproduce
Content-Type: application/json

{
  "errorId": "uuid-from-detect",
  "repoUrl": "https://github.com/myorg/myrepo",
  "branch": "main"
}
```

### Status Monitoring
```http
GET /api/cloud/status
```

Returns:
```json
{
  "totalErrors": 10,
  "unreproduced": 2,
  "reproductions": {
    "pending": 1,
    "running": 1,
    "completed": 8,
    "failed": 0
  },
  "recentErrors": [...]
}
```

## Architecture

```
Production Site → /api/cloud/detect → Store Error
                                     ↓
                          /api/cloud/reproduce
                                     ↓
                          Vercel Sandbox (isolated VM)
                                     ↓
                          Run d3k + Reproduce Error
                                     ↓
                          Return Analysis + Logs
```

## Phase 1 POC Features

✅ **Implemented:**
- Error detection API
- In-memory error storage
- Reproduction workflow API
- Status monitoring API
- Vercel deployment configuration

🚧 **Coming in Phase 2:**
- Actual Vercel Sandbox integration
- Database storage (replaces in-memory)
- Vercel Queues for async processing
- Vercel Workflow for durable debugging
- AI Gateway for fix generation
- Automated PR creation

## Local Development

```bash
# Install dependencies (from monorepo root)
cd ..
pnpm install

# Link to Vercel project and pull env vars
cd mcp-server
vercel link
vercel env pull

# Start dev server
pnpm dev

# Open http://localhost:3000
```

## Monorepo Structure

This server is part of the dev3000 monorepo:

```
dev3000/                  # Monorepo root
├── mcp-server/          # This directory (deployed to Vercel)
│   ├── app/
│   │   └── api/cloud/   # Cloud API routes
│   ├── lib/cloud/       # Cloud utilities
│   ├── vercel.json      # Deployment config
│   └── .vercelignore    # Ignore rules
├── src/                 # Shared utilities
└── package.json         # Workspace config
```

The `vercel.json` configures the build to:
1. Set `mcp-server/` as root directory
2. Run `cd .. && pnpm install` to install from monorepo root
3. Build using `pnpm build`

## Contributing

See main [CONTRIBUTING.md](../CONTRIBUTING.md) in the repository root.

## License

MIT - See [LICENSE](../LICENSE)

## Resources

- [Full Documentation](../docs/cloud-phase-1-poc.md)
- [Deployment Setup Guide](../docs/vercel-deployment-setup.md)
- [Vercel Sandbox Docs](https://vercel.com/docs/vercel-sandbox)
