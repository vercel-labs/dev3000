# Vercel Deployment Setup for dev3000 Cloud

This guide walks through setting up a Vercel project for the dev3000 MCP server to enable cloud monitoring capabilities.

## Prerequisites

- Vercel account (sign up at https://vercel.com)
- Vercel CLI installed: `npm i -g vercel`
- Access to vercel-labs/dev3000 repository

## Step 1: Create Vercel Project

### Option A: Via Vercel Dashboard (Recommended)

1. Go to https://vercel.com/new
2. Import the `vercel-labs/dev3000` repository
3. Configure the project:
   - **Project Name**: `dev3000-mcp-server` (or your preferred name)
   - **Framework Preset**: Next.js
   - **Root Directory**: `mcp-server/` ⚠️ **IMPORTANT**
   - **Build Command**: `pnpm build`
   - **Output Directory**: `.next` (default)
   - **Install Command**: `cd .. && pnpm install`

4. Configure Build & Development Settings:
   - **Node.js Version**: 20.x (recommended)
   - **Include source files outside of the Root Directory in the Build Step**: ✅ Enabled

### Option B: Via CLI

```bash
cd mcp-server

# Link to Vercel (creates .vercel directory)
vercel link

# Follow the prompts:
# - Link to existing project? No
# - What's your project's name? dev3000-mcp-server
# - In which directory is your code located? ./
```

## Step 2: Configure Environment Variables

Add the following environment variables in your Vercel project settings:

```bash
# Repository URL for cloning in sandbox
REPO_URL=https://github.com/vercel-labs/dev3000.git

# Optional: Specify branch for reproduction
REPO_BRANCH=main

# Log paths (for cloud mode)
LOG_FILE_PATH=/tmp/d3k/logs
SCREENSHOT_DIR=/tmp/d3k/screenshots
```

### Authentication

Vercel Sandbox uses OIDC tokens automatically - no separate sandbox token needed! The SDK will automatically use the `VERCEL_OIDC_TOKEN` that Vercel provides to all deployed functions. For local development, run `vercel env pull` to get a development OIDC token in `.env.local`.

## Step 3: Configure Ignored Build Step (Monorepo)

To prevent unnecessary builds when other parts of the monorepo change:

1. Go to Project Settings → Git
2. Under "Ignored Build Step", add:
   ```bash
   git diff HEAD^ HEAD --quiet ./mcp-server
   ```

This ensures builds only trigger when files in `mcp-server/` actually change.

## Step 4: Deploy

### First Deployment

```bash
cd mcp-server
vercel --prod
```

Or push to `main` branch and Vercel will auto-deploy.

### Verify Deployment

Once deployed, verify the endpoints are working:

```bash
# Health check
curl https://your-deployment.vercel.app/api/cloud/status

# Should return:
# {
#   "totalErrors": 0,
#   "unreproduced": 0,
#   "reproductions": { "pending": 0, "running": 0, "completed": 0, "failed": 0 },
#   "recentErrors": []
# }
```

## Step 5: Test Error Detection

Send a test error to verify the pipeline:

```bash
curl -X POST https://your-deployment.vercel.app/api/cloud/detect \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Test error from curl",
    "url": "https://example.com/test",
    "userAgent": "curl/test",
    "severity": "error"
  }'

# Should return:
# {
#   "success": true,
#   "errorId": "uuid-here",
#   "message": "Error recorded successfully"
# }
```

Then check status again:
```bash
curl https://your-deployment.vercel.app/api/cloud/status
# Should now show 1 error
```

## Step 6: Set Up Local Development

Link your local environment to the deployed project:

```bash
cd mcp-server

# Link to project
vercel link

# Pull environment variables
vercel env pull

# Start dev server
pnpm dev
```

This creates a `.env.local` file with your production environment variables.

## Project Structure

```
mcp-server/
├── .vercel/              # Vercel project config (git-ignored)
├── .vercelignore         # Files to ignore during deployment
├── vercel.json           # Deployment configuration
├── app/
│   ├── api/
│   │   └── cloud/        # Cloud API endpoints
│   │       ├── detect/   # Error detection
│   │       ├── reproduce/# Error reproduction
│   │       └── status/   # Status monitoring
│   └── ...
└── lib/
    └── cloud/            # Cloud utilities
        └── types.ts      # TypeScript definitions
```

## Troubleshooting

### Build fails with "Cannot find module"

Make sure `installCommand` in `vercel.json` is set to:
```json
"installCommand": "cd .. && pnpm install"
```

This ensures pnpm installs dependencies from the monorepo root.

### Environment variables not available

Run `vercel env pull` to sync environment variables from Vercel to your local `.env.local`.

### Builds triggered for unrelated changes

Check your "Ignored Build Step" configuration in Vercel project settings.

## Next Steps

- [ ] Install Vercel Sandbox SDK: `cd mcp-server && pnpm add @vercel/sandbox`
- [ ] Implement actual sandbox reproduction logic
- [ ] Create monitoring client script for production sites
- [ ] Build cloud dashboard UI
- [ ] Test end-to-end error detection → reproduction → reporting

## Resources

- [Vercel Monorepos Documentation](https://vercel.com/docs/monorepos)
- [Vercel Sandbox Documentation](https://vercel.com/docs/vercel-sandbox)
- [Next.js Deployment](https://nextjs.org/docs/app/building-your-application/deploying)
