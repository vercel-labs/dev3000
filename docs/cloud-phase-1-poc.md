# dev3000 Cloud - Phase 1 POC

## Overview
Deploy the dev3000 MCP server to Vercel as a cloud service that can detect errors in production sites, reproduce them in Vercel Sandbox, and generate reports.

## Goals
- [x] Deploy MCP server as Vercel API routes
- [ ] Implement error detection from production sites
- [ ] Integrate Vercel Sandbox for error reproduction
- [ ] Create simple workflow: detect → reproduce → report
- [ ] Build basic dashboard showing detected issues

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Production Site                          │
│  (User's deployed app with monitoring injected)             │
└────────────────────────┬────────────────────────────────────┘
                         │ Errors detected
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Vercel API Routes (MCP Server)                  │
│  • /api/cloud/detect - Receive error reports                │
│  • /api/cloud/reproduce - Trigger sandbox reproduction      │
│  • /api/cloud/status - Get workflow status                  │
└────────────────────────┬────────────────────────────────────┘
                         │ Trigger reproduction
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  Vercel Sandbox                              │
│  • Clone repo                                                │
│  • Run d3k --no-tui                                         │
│  • Execute error reproduction steps                         │
│  • Capture logs and screenshots                             │
└────────────────────────┬────────────────────────────────────┘
                         │ Return analysis
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Dashboard                                 │
│  • Show detected errors                                      │
│  • Display reproduction results                              │
│  • View logs and screenshots                                 │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Steps

### Step 1: Vercel Deployment Configuration ✅
- [x] Create `vercel.json` for mcp-server
- [x] Configure root directory as `mcp-server/`
- [x] Set up environment variables
- [x] Configure build ignore for monorepo

### Step 2: Cloud API Routes
Create new API routes specifically for cloud functionality:

```typescript
// mcp-server/app/api/cloud/detect/route.ts
export async function POST(request: Request) {
  const error = await request.json()
  // Store error, queue for reproduction
}

// mcp-server/app/api/cloud/reproduce/route.ts
export async function POST(request: Request) {
  const { errorId } = await request.json()
  // Spin up Vercel Sandbox, reproduce error
}

// mcp-server/app/api/cloud/status/route.ts
export async function GET(request: Request) {
  // Return status of all reproduction workflows
}
```

### Step 3: Vercel Sandbox Integration
Install and configure Vercel Sandbox SDK:

```bash
cd mcp-server
pnpm add @vercel/sandbox
```

Create sandbox manager:
```typescript
// mcp-server/lib/cloud/sandbox-manager.ts
import { Sandbox } from '@vercel/sandbox'

export async function reproduceError(error: ProductionError) {
  const sandbox = await Sandbox.create({
    source: {
      url: process.env.REPO_URL,
      type: 'git'
    },
    resources: {
      vcpus: 4,
      memory: 8192
    }
  })

  // Run d3k
  await sandbox.run('pnpm global add dev3000@latest')
  await sandbox.run('d3k --no-tui --servers-only')

  // Execute reproduction steps
  const result = await sandbox.run(
    `curl -X POST http://localhost:3684/mcp/tools/fix_my_app`
  )

  return result
}
```

### Step 4: Error Detection Client
Create lightweight monitoring script to inject into production sites:

```typescript
// mcp-server/public/monitor.js
(function() {
  window.addEventListener('error', async (event) => {
    await fetch('https://your-app.vercel.app/api/cloud/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: event.message,
        stack: event.error?.stack,
        url: window.location.href,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent
      })
    })
  })
})()
```

### Step 5: Basic Dashboard
Extend existing `/logs` page to show cloud detections:

```typescript
// mcp-server/app/cloud/page.tsx
export default function CloudDashboard() {
  return (
    <div>
      <h1>Production Error Monitor</h1>
      <ErrorList />
      <ReproductionStatus />
    </div>
  )
}
```

## Environment Variables

Required for Vercel deployment:

```bash
# .env.production
VERCEL_SANDBOX_TOKEN=<your-token>
REPO_URL=https://github.com/your-org/your-repo.git
LOG_FILE_PATH=/tmp/d3k/logs
SCREENSHOT_DIR=/tmp/d3k/screenshots
```

## Testing Plan

1. Deploy to Vercel staging
2. Inject monitor script into test site
3. Trigger test error
4. Verify detection via `/api/cloud/detect`
5. Trigger reproduction via `/api/cloud/reproduce`
6. Check dashboard for results

## Success Criteria

- [x] MCP server deploys to Vercel successfully
- [ ] Can receive error reports from production sites
- [ ] Can spin up Vercel Sandbox on demand
- [ ] Can reproduce errors in sandbox environment
- [ ] Dashboard displays detected errors and reproduction status
- [ ] End-to-end flow takes < 5 minutes

## Next Steps (Phase 2)

- Implement Vercel Queues for async processing
- Add Vercel Workflow for durable multi-step debugging
- Integrate AI Gateway for fix generation
- Add PR automation
- Implement visual regression testing

## Resources

- [Vercel Sandbox Docs](https://vercel.com/docs/vercel-sandbox)
- [Vercel Monorepo Deployment](https://vercel.com/docs/monorepos)
- [Next.js API Routes](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
