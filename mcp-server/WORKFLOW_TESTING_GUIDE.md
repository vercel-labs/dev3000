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

**IMPORTANT**: Always use d3k MCP tools for testing workflows. Do NOT use curl or manual API calls - use d3k's browser automation instead.

### Step 1: Navigate to Workflow Form and Trigger

Use d3k browser automation (via `execute_browser_action` MCP tool):

```typescript
// Navigate to workflow form with all required parameters
execute_browser_action({
  action: "navigate",
  params: {
    url: "http://localhost:3000/workflows/new?type=cloud-fix&team=team_AOfCfb0WM8wEQYM5swopmVwn&project=prj_9kvdjxXYqydZsyifQmpbfjimvjHv"
  }
})

// Wait for page to load (2-3 seconds)
// Then click "Start Workflow" button
execute_browser_action({
  action: "evaluate",
  params: {
    expression: "Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('Start Workflow'))?.click()"
  }
})
```

### Step 2: Monitor UI Status

```typescript
// Check current UI status
execute_browser_action({
  action: "evaluate",
  params: {
    expression: "document.body.innerText"
  }
})

// Look for status messages:
// - "Generating fix proposal..."
// - "Creating sandbox..."
// - "Writing code..."
// - "Workflow completed successfully"
```

**Note**: UI has a 5-minute timeout, but workflow can take up to 10 minutes to complete in production.

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

Use d3k browser automation to check workflow status:

```typescript
// Navigate to workflows list page
execute_browser_action({
  action: "navigate",
  params: { url: "http://localhost:3000/workflows" }
})

// Wait for page to load, then check workflow status
execute_browser_action({
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

## Testing Sandbox Dev URLs

When a workflow creates a sandbox, it logs the Dev URL like:
```
[Step 0] Dev URL: https://sb-6xydwiqnuv8o.vercel.run
```

### Extract Dev URL from Logs

**From Vercel production logs:**
```bash
# Get latest deployment
DEPLOYMENT=$(vercel ls --scope team_AOfCfb0WM8wEQYM5swopmVwn | grep dev3000 | head -1 | awk '{print $2}')

# Extract Dev URL
vercel logs $DEPLOYMENT --scope team_AOfCfb0WM8wEQYM5swopmVwn 2>&1 | grep "Dev URL:" | tail -1
```

**From real-time monitoring:**
```bash
# Monitor logs and extract Dev URL as it appears
vercel logs --follow d3k-mcp.vercel.sh --scope team_AOfCfb0WM8wEQYM5swopmVwn 2>&1 | grep -o "https://sb-[a-z0-9]*\.vercel\.run"
```

### Test Dev URL with Browser Automation

Once you have the Dev URL, test it using d3k MCP:

```typescript
// Navigate to the Dev URL from logs
execute_browser_action({
  action: "navigate",
  params: {
    url: "https://sb-6xydwiqnuv8o.vercel.run"  // Replace with actual URL from logs
  }
})

// Wait a few seconds for page to load, then take a screenshot
execute_browser_action({
  action: "screenshot"
})

// Check for any errors in the page
execute_browser_action({
  action: "evaluate",
  params: {
    expression: `
      JSON.stringify({
        title: document.title,
        errors: window.__errors || [],
        url: location.href
      })
    `
  }
})
```

### Verify Dev URL is Accessible

The Dev URL should:
- ✅ Return HTTP 200 (not 502 SANDBOX_NOT_LISTENING)
- ✅ Actually render the homepage HTML
- ✅ Load CSS and JavaScript resources successfully
- ✅ Not hang or timeout

**Common Issues:**

| Issue | Cause | Fix |
|-------|-------|-----|
| HTTP 502 "SANDBOX_NOT_LISTENING" | Dev server binding to localhost instead of 0.0.0.0 | Update d3k to pass `--hostname 0.0.0.0` to Next.js |
| Page loads but very broken | Resources failing to load | Check network tab for failed requests |
| Hangs indefinitely | Sandbox not ready or crashed | Check sandbox logs for errors |

### Test from Command Line

```bash
# Quick test with curl
curl -I https://sb-XXXXX.vercel.run

# Expected: HTTP 200 (or 308 redirect if protected)
# Bad: HTTP 502 or timeout
```

### Automated Testing Script

```bash
#!/bin/bash
# Extract and test Dev URL from latest workflow

echo "1. Getting latest deployment..."
DEPLOYMENT=$(vercel ls --scope team_AOfCfb0WM8wEQYM5swopmVwn | grep dev3000 | head -1 | awk '{print $2}')
echo "   Deployment: $DEPLOYMENT"

echo "2. Extracting Dev URL from logs..."
DEV_URL=$(vercel logs $DEPLOYMENT --scope team_AOfCfb0WM8wEQYM5swopmVwn 2>&1 | grep -o "https://sb-[a-z0-9]*\.vercel\.run" | tail -1)
echo "   Dev URL: $DEV_URL"

if [ -z "$DEV_URL" ]; then
  echo "   ❌ No Dev URL found in logs"
  exit 1
fi

echo "3. Testing Dev URL with curl..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -I $DEV_URL)
echo "   HTTP Status: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "308" ]; then
  echo "   ✅ Dev URL is accessible"
else
  echo "   ❌ Dev URL returned error: $HTTP_CODE"
fi

echo "4. Use dev3000 MCP to test in browser:"
echo "   execute_browser_action({ action: 'navigate', params: { url: '$DEV_URL' } })"
```

## Summary

**Always check BOTH:**
1. ✅ Local logs (`~/.d3k/logs/`) - Shows API was called
2. ✅ Production logs (Vercel dashboard or CLI) - Shows workflow actually executed
3. ✅ Test Dev URLs (if sandbox created) - Verify sandbox is accessible

**If production logs are empty**, workflow was never created - check OIDC token!

**If Dev URL returns 502**, the dev server isn't binding to 0.0.0.0 for external access.
