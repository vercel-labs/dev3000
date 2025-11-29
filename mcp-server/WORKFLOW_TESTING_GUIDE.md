# Workflow Testing Guide

Quick reference for testing mcp-server workflows end-to-end with proper monitoring.

## Prerequisites

### 1. Verify OIDC Token is Valid

```bash
cd /Users/elsigh/src/vercel-labs/dev3000/mcp-server

# Check token expiration
node -e "
require('dotenv').config({ path: '.env.local' });
const token = process.env.VERCEL_OIDC_TOKEN || '';
if (token) {
  const payload = token.split('.')[1];
  const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
  const exp = new Date(decoded.exp * 1000);
  const now = new Date();
  console.log('Token expires:', exp.toISOString());
  console.log('Current time:', now.toISOString());
  console.log('Expired:', now > exp ? 'YES ❌' : 'NO ✅');
  if (now > exp) {
    console.log('Expired', Math.floor((now - exp) / 1000 / 60), 'minutes ago');
  } else {
    console.log('Time until expiry:', Math.floor((exp - now) / 1000 / 60), 'minutes');
  }
}
"
```

**If expired**, refresh the token:
```bash
vercel env pull .env.local --scope team_AOfCfb0WM8wEQYM5swopmVwn
```

Then restart the dev server (kill and restart d3k).

### 2. Ensure d3k is Running

```bash
# Check if d3k is running on mcp-server
pgrep -f "d3k.*mcp-server" || echo "d3k not running"

# If not running, start it
cd /Users/elsigh/src/vercel-labs/dev3000/mcp-server
pnpm d3k
```

## Test Workflow Creation

### Step 1: Navigate to Workflow Form

Use d3k browser automation to navigate and trigger workflow:

```typescript
// Navigate to workflow form with all required parameters
await execute_browser_action({
  action: "navigate",
  params: {
    url: "http://localhost:3000/workflows/new?type=cloud-fix&team=team_AOfCfb0WM8wEQYM5swopmVwn&project=prj_9kvdjxXYqydZsyifQmpbfjimvjHv"
  }
})

// Wait for page to load
await sleep(2)

// Click "Start Workflow" button
await execute_browser_action({
  action: "evaluate",
  params: {
    expression: "Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('Start Workflow'))?.click()"
  }
})
```

### Step 2: Check UI Status

```typescript
// Monitor the UI for status changes
await execute_browser_action({
  action: "evaluate",
  params: {
    expression: "document.body.innerText"
  }
})

// Look for status: "Generating fix proposal...", "Writing code...", etc.
```

**Note**: UI has a 5-minute timeout, but workflow can take up to 10 minutes.

## Monitor Logs Correctly

### CRITICAL: Monitor BOTH Local AND Production Logs

❌ **Common Mistake**: Only checking local logs
✅ **Correct**: Check BOTH local AND Vercel production logs

### Monitor Local Logs (shows API calls)

```bash
# Find latest log file
ls -lat ~/.d3k/logs/ | head -5

# Monitor workflow activity
grep -i "workflow\|sandbox\|step" ~/.d3k/logs/dev3000-mcp-server-*.log | tail -50
```

**What to look for in local logs:**
- `[Workflow] Starting cloud fix workflow...`
- `POST /api/cloud/start-fix 200 in Xms`

**Important**: Local logs showing "200 OK" does NOT mean the workflow succeeded in production!

### Monitor Vercel Production Logs (shows actual workflow execution)

```bash
# Get the most recent production deployment URL
vercel ls --scope team_AOfCfb0WM8wEQYM5swopmVwn | head -2

# Monitor production logs for that deployment
vercel logs https://dev3000-XXXXX.vercel.sh --scope team_AOfCfb0WM8wEQYM5swopmVwn 2>&1 | grep -i "workflow\|sandbox\|step"
```

**Or check the Vercel Dashboard:**
https://dash.vercel.com/vercel/dev3000-mcp/[DEPLOYMENT_ID]/logs

**What to look for in production logs:**
- `[Workflow] Starting cloud fix workflow...` - Workflow started
- `[Step 0] Creating d3k sandbox...` - Sandbox creation
- `[Step 0] Sandbox created successfully` - Sandbox ready
- `[Step 0] Executing MCP command inside sandbox...` - Running fix_my_app
- `[Step 1] Analyzing logs with AI agent...` - AI analysis
- `[Step 2] Uploading to blob storage...` - Saving report
- `[Step 3] Creating GitHub PR...` - Creating PR (if applicable)

**If production logs are empty**: The workflow was NOT created - likely due to expired OIDC token.

### Check Workflow Status in UI

```bash
# Navigate to workflows list
curl -s http://localhost:3000/workflows | grep -o "tailwind-plus-transmit.*running\|success\|failure" | head -5
```

Or use d3k browser automation:
```typescript
await execute_browser_action({
  action: "navigate",
  params: { url: "http://localhost:3000/workflows" }
})

await sleep(2)

await execute_browser_action({
  action: "evaluate",
  params: { expression: "document.body.innerText" }
})
```

Look for the most recent workflow entry with:
- Status: `running` | `success` | `failure`
- Report: Link to view report (if completed)
- PR: Link to GitHub PR (if created)

## Expected Timeline

Typical workflow execution:

| Step | Duration | What's Happening |
|------|----------|------------------|
| Step 0: Sandbox Creation | 1-2 min | Clone repo, install deps, start d3k |
| Step 0: MCP Execution | 5-10 min | Run fix_my_app inside sandbox |
| Step 1: AI Analysis | 2-5 min | Analyze logs, generate fixes |
| Step 2: Blob Upload | 10-30 sec | Save report to Vercel Blob |
| Step 3: PR Creation | 10-30 sec | Create GitHub PR (optional) |
| **Total** | **8-18 min** | Full workflow execution |

**UI Timeout**: Frontend polls for 5 minutes, may show "timeout" error even if backend succeeds.

## Troubleshooting

### Issue: "No logs in production"
**Cause**: OIDC token expired
**Fix**: Run `vercel env pull .env.local --scope team_AOfCfb0WM8wEQYM5swopmVwn` and restart dev server

### Issue: "Workflow stuck in 'running' state"
**Cause**: Workflow exceeded 10-minute Vercel Function timeout
**Fix**: Check production logs for where it failed, may need to optimize MCP execution

### Issue: "UI shows timeout but backend succeeded"
**Cause**: UI 5-minute timeout < workflow 10-minute execution
**Fix**: This is expected, check workflows list page for actual status

### Issue: "Can't see production logs"
**Cause**: Looking at wrong deployment or wrong time range
**Fix**: Get latest deployment from `vercel ls` and check dashboard with correct timestamp

## Quick Test Script

```bash
#!/bin/bash
# Quick workflow test script

echo "1. Checking OIDC token..."
node -e "require('dotenv').config({ path: '.env.local' }); const token = process.env.VERCEL_OIDC_TOKEN || ''; if (token) { const payload = token.split('.')[1]; const decoded = JSON.parse(Buffer.from(payload, 'base64').toString()); const exp = new Date(decoded.exp * 1000); const now = new Date(); console.log(now > exp ? '❌ EXPIRED' : '✅ Valid'); } else { console.log('❌ No token'); }"

echo "2. Getting latest deployment..."
DEPLOYMENT=$(vercel ls --scope team_AOfCfb0WM8wEQYM5swopmVwn | head -2 | tail -1)
echo "Latest: $DEPLOYMENT"

echo "3. Triggering workflow via d3k..."
echo "   (Use d3k browser automation to click 'Start Workflow')"

echo "4. Monitoring production logs..."
echo "   vercel logs $DEPLOYMENT --scope team_AOfCfb0WM8wEQYM5swopmVwn"
```

## Summary

**Always check BOTH:**
1. ✅ Local logs (`~/.d3k/logs/`) - Shows API was called
2. ✅ Production logs (Vercel dashboard or CLI) - Shows workflow actually executed

**If production logs are empty**, workflow was never created - check OIDC token!
