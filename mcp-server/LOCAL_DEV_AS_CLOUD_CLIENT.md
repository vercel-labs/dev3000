# Running Local Dev Server as Cloud Client

This guide explains how to configure your local dev server to be just a "view" to cloud workflows, without executing any workflows locally.

## Why?

When you run the dev server locally (`localhost:3000`), by default it will:
- Execute workflows locally when you create them
- Require local environment variables (API keys, tokens, etc.)
- Need local resources (sandboxes, browser automation, etc.)

Instead, you can configure it to:
- Always execute workflows in the cloud (on your production deployment)
- Just act as a UI/dashboard to view and trigger cloud workflows
- Avoid needing API keys or secrets locally

## Setup

### 1. Create `.env.local`

Copy the example environment file:

```bash
cd mcp-server
cp .env.local.example .env.local
```

### 2. Configure Cloud API URL

Edit `.env.local` and uncomment the `NEXT_PUBLIC_WORKFLOW_API_URL` line:

```bash
# Before
# NEXT_PUBLIC_WORKFLOW_API_URL=https://d3k-mcp.vercel.sh

# After
NEXT_PUBLIC_WORKFLOW_API_URL=https://d3k-mcp.vercel.sh
```

Replace `https://d3k-mcp.vercel.sh` with your actual production URL if different.

### 3. Start Local Dev Server

```bash
pnpm run dev
```

### 4. Test

1. Visit `http://localhost:3000/workflows`
2. Click "New Workflow"
3. Configure and start a workflow
4. **The workflow will execute in the cloud**, not locally!
5. Results are fetched from cloud blob storage

## What This Changes

### With Cloud Client Mode (NEXT_PUBLIC_WORKFLOW_API_URL set):

```
Local Browser (localhost:3000)
  ↓
  Calls: https://d3k-mcp.vercel.sh/api/cloud/start-fix
  ↓
Production Server (Vercel)
  ↓
Creates Sandbox → Runs d3k → Executes Workflow
  ↓
Saves results to Blob Storage
  ↓
Local UI shows results (from cloud)
```

### Without Cloud Client Mode (default):

```
Local Browser (localhost:3000)
  ↓
  Calls: /api/cloud/start-fix (relative path)
  ↓
Local Server (localhost:3000)
  ↓
Tries to create sandbox locally (requires API keys, etc.)
  ↓
Executes workflow locally
```

## Benefits

- **No API Keys Needed Locally**: All secrets stay in production
- **Consistent Execution**: Workflows always run in the same environment
- **Easy Testing**: Test the UI locally without complex setup
- **True Cloud Workflows**: See exactly how workflows behave in production

## Caveats

- You need internet connection to create workflows (calls production API)
- OAuth still needs to be configured for authentication
- Viewing workflows list works either way (reads from cloud blob storage)

## Production Deployment

When you deploy to Vercel, `NEXT_PUBLIC_WORKFLOW_API_URL` should **not** be set (or set to empty string). The production app will use relative paths and execute workflows directly.

```bash
# In production (Vercel)
# NEXT_PUBLIC_WORKFLOW_API_URL should be unset or empty
# This makes production execute workflows itself, not delegate to another URL
```
