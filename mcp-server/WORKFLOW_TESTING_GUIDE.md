# Workflow Testing Guide

Quick reference for testing mcp-server workflows end-to-end with proper monitoring.

## After Committing Code Changes

When you push code to main, Vercel auto-deploys. **Don't wait for the user** - proactively monitor and verify:

1. **Start monitoring immediately after push:**
   ```bash
   vercel logs d3k-mcp.vercel.app --scope team_nLlpyC6REAqxydlFKbrMDlud
   ```

2. **Watch for deployment completion:**
   - New log activity indicates the new deployment is live
   - Or check `vercel ls --scope team_nLlpyC6REAqxydlFKbrMDlud` to see latest deployment

3. **Proceed with testing:**
   - Once deployed, start the workflow test immediately
   - Don't wait for user confirmation - be proactive

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
vercel env pull .env.local --scope team_nLlpyC6REAqxydlFKbrMDlud
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
    url: "http://localhost:3000/workflows/new?type=cloud-fix&team=team_aMS4jZUlMooxyr9VgMKJf9uT&project=prj_0ITI5UHrH4Kp92G5OLEMrlgVX08p"
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

### Step 2: Start Monitoring Production Logs BEFORE Triggering Workflow

**CRITICAL**: The `vercel logs` command only streams logs that occur AFTER you start monitoring. You must start monitoring BEFORE clicking "Start Workflow" or you will miss the logs!

❌ **DO NOT TRUST THE UI**: UI showing "Writing code..." does NOT mean the workflow is running
✅ **ONLY TRUST PRODUCTION LOGS**: Use `vercel logs` CLI to verify actual execution

**⚠️ IMPORTANT: Start monitoring in a separate terminal BEFORE triggering the workflow:**

```bash
# Terminal 1: Start monitoring FIRST (before clicking Start Workflow)
# NOTE: Monitor the mcp-server production project, NOT the test project!
DEPLOYMENT=$(vercel ls --scope team_nLlpyC6REAqxydlFKbrMDlud | grep dev3000 | head -1 | awk '{print $2}')
echo "Monitoring: $DEPLOYMENT"
vercel logs $DEPLOYMENT --scope team_nLlpyC6REAqxydlFKbrMDlud

# Terminal 2: THEN trigger the workflow via browser automation
# (or use the Vercel Dashboard to view logs in real-time)
```

**Why this matters:** The `vercel logs` CLI streams logs in real-time but does NOT show historical logs. If you start monitoring after the workflow begins, you'll see "waiting for new logs..." and miss the actual execution logs.

## Monitor Logs Correctly

### CRITICAL: Production Logs Are the ONLY Source of Truth

❌ **DO NOT RELY ON**: UI status, local logs alone, or assumptions
✅ **ALWAYS VERIFY WITH**: Vercel CLI production logs

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

### Production Logs via Vercel CLI (REQUIRED - Source of Truth)

**This is the ONLY way to verify workflow execution.** Always use CLI, never dashboard.

```bash
# Step 1: Get latest deployment URL for mcp-server production
DEPLOYMENT=$(vercel ls --scope team_nLlpyC6REAqxydlFKbrMDlud | grep dev3000 | head -1 | awk '{print $2}')
echo "Checking logs for: $DEPLOYMENT"

# Step 2: Monitor production logs for workflow activity
vercel logs $DEPLOYMENT --scope team_nLlpyC6REAqxydlFKbrMDlud 2>&1 | grep -i "workflow\|sandbox\|step"

# Step 3: If no output, check all recent logs (no grep filter)
vercel logs $DEPLOYMENT --scope team_nLlpyC6REAqxydlFKbrMDlud 2>&1 | tail -100
```

**What MUST appear in production logs for successful execution:**
- `[Workflow] Starting cloud fix workflow...` - Workflow initiated in production
- `[Step 0] Creating d3k sandbox...` - Sandbox creation started
- `[Step 0] Sandbox created successfully` - Sandbox is ready
- `[Step 0] Executing MCP command inside sandbox...` - Running fix_my_app
- `[Step 0] Dev URL: https://sb-XXXXX.vercel.run` - Sandbox URL available
- `[Step 1] Analyzing logs with AI agent...` - AI analysis phase
- `[Step 2] Uploading to blob storage...` - Report generation
- `[Step 3] Creating GitHub PR...` - PR creation (if enabled)

**If production logs show NOTHING**:
- ❌ Workflow was NOT created despite UI showing progress
- Most likely cause: Expired OIDC token
- Solution: Run `vercel env pull .env.local --scope team_nLlpyC6REAqxydlFKbrMDlud` and restart dev server

### Checking Final Workflow Results

After production logs confirm completion, you can check results via CLI:

```bash
# List all deployments for mcp-server production
vercel ls --scope team_nLlpyC6REAqxydlFKbrMDlud | head -20

# Or check the workflows page in browser (ONLY after production logs confirm completion)
# Navigate to: http://localhost:3000/workflows
```

**Remember**: Only check UI AFTER production logs confirm the workflow completed. UI status alone is unreliable.

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
**Fix**: Run `vercel env pull .env.local --scope team_nLlpyC6REAqxydlFKbrMDlud` and restart dev server

### Issue: "Workflow stuck in 'running' state"
**Cause**: Workflow exceeded 10-minute Vercel Function timeout
**Fix**: Check production logs for where it failed, may need to optimize MCP execution

### Issue: "UI shows timeout but backend succeeded"
**Cause**: UI 5-minute timeout < workflow 10-minute execution
**Fix**: This is expected, check workflows list page for actual status

### Issue: "Can't see production logs"
**Cause**: Looking at wrong deployment or wrong time range
**Fix**: Get latest deployment from `vercel ls` and check dashboard with correct timestamp

### Issue: "MCP error: Cannot read properties of undefined (reading 'output')"
**Cause**: The MCP tool response format changed or there's a bug in parsing the response in the workflow code
**Symptoms**:
- Logs show: `[Step 1] Note: MCP error from Step 0: MCP execution error: Cannot read properties of undefined (reading 'output')`
- Workflow times out at 300 seconds
**Fix**: Check `mcp-server/app/api/cloud/fix-workflow/workflow.ts` for how MCP responses are parsed

### Issue: "Sandbox page hangs (HTTP HEAD works but full page doesn't load)"
**Cause**: SSR/rendering issues in the sandbox, or the sandbox dev server crashed after initial startup
**Symptoms**:
- `curl -I https://sb-XXXXX.vercel.run` returns HTTP 200
- `curl https://sb-XXXXX.vercel.run` hangs indefinitely
- Browser navigation times out
**Fix**: Check sandbox logs for errors, may need to investigate the target app's SSR behavior

## Quick Test Script

```bash
#!/bin/bash
# Quick workflow test script

echo "1. Checking OIDC token..."
node -e "require('dotenv').config({ path: '.env.local' }); const token = process.env.VERCEL_OIDC_TOKEN || ''; if (token) { const payload = token.split('.')[1]; const decoded = JSON.parse(Buffer.from(payload, 'base64').toString()); const exp = new Date(decoded.exp * 1000); const now = new Date(); console.log(now > exp ? '❌ EXPIRED' : '✅ Valid'); } else { console.log('❌ No token'); }"

echo "2. Getting latest mcp-server deployment..."
DEPLOYMENT=$(vercel ls --scope team_nLlpyC6REAqxydlFKbrMDlud | head -2 | tail -1)
echo "Latest: $DEPLOYMENT"

echo "3. Triggering workflow via d3k..."
echo "   (Use d3k browser automation to click 'Start Workflow')"

echo "4. Monitoring production logs..."
echo "   vercel logs $DEPLOYMENT --scope team_nLlpyC6REAqxydlFKbrMDlud"
```

## Testing Sandbox Dev URLs

When a workflow creates a sandbox, it logs the Dev URL like:
```
[Step 0] Dev URL: https://sb-6xydwiqnuv8o.vercel.run
```

### Extract Dev URL from Logs

**From Vercel production logs:**
```bash
# Get latest mcp-server deployment
DEPLOYMENT=$(vercel ls --scope team_nLlpyC6REAqxydlFKbrMDlud | grep dev3000 | head -1 | awk '{print $2}')

# Extract Dev URL
vercel logs $DEPLOYMENT --scope team_nLlpyC6REAqxydlFKbrMDlud 2>&1 | grep "Dev URL:" | tail -1
```

**From real-time monitoring:**
```bash
# Monitor logs and extract Dev URL as it appears
vercel logs --follow d3k-mcp.vercel.sh --scope team_nLlpyC6REAqxydlFKbrMDlud 2>&1 | grep -o "https://sb-[a-z0-9]*\.vercel\.run"
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

echo "1. Getting latest mcp-server deployment..."
DEPLOYMENT=$(vercel ls --scope team_nLlpyC6REAqxydlFKbrMDlud | grep dev3000 | head -1 | awk '{print $2}')
echo "   Deployment: $DEPLOYMENT"

echo "2. Extracting Dev URL from logs..."
DEV_URL=$(vercel logs $DEPLOYMENT --scope team_nLlpyC6REAqxydlFKbrMDlud 2>&1 | grep -o "https://sb-[a-z0-9]*\.vercel\.run" | tail -1)
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
