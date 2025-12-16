# Workflow Testing Guide

Quick reference for testing d3k workflows end-to-end with proper monitoring.

## Quick Start (Copy-Paste Ready)

**For Claude: Follow these exact steps every time you test a workflow.**

### Step 1: Get bypass token and construct URL
```bash
# Get bypass token
BYPASS=$(grep WORKFLOW_TEST_BYPASS_TOKEN /Users/elsigh/src/vercel-labs/dev3000/www/.env.local | cut -d'"' -f2)
echo "URL: http://localhost:3000/workflows/new?type=cloud-fix&team=team_aMS4jZUlMooxyr9VgMKJf9uT&project=prj_0ITI5UHrH4Kp92G5OLEMrlgVX08p&bypass=$BYPASS"
```

### Step 2: Start log monitoring (background)
```bash
vercel logs $(vercel ls --scope team_nLlpyC6REAqxydlFKbrMDlud 2>/dev/null | head -1) --scope team_nLlpyC6REAqxydlFKbrMDlud &
```

### Step 3: Navigate and click Start Workflow
```typescript
// Navigate (use the full URL from Step 1)
execute_browser_action({ action: "navigate", params: { url: "<FULL_URL_FROM_STEP_1>" }})

// Wait 10 seconds, then click Start Workflow
execute_browser_action({ action: "evaluate", params: { expression: "Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('Start Workflow'))?.click()" }})
```

### Step 4: Watch logs for progress
Look for these in the logs:
- `[Start Fix] Generated runId: d3k_xxx` - Workflow started with proper ID
- `[Workflow] Starting cloud fix workflow...` - Workflow running
- `[Workflow] Result: improved` - Success!

---

## Architecture Overview

**Important**: Workflows now run in `www` (d3k.dev), not mcp-server.

- **All Environments**: The frontend always calls `https://dev3000.ai/api/cloud/start-fix` directly
- **No local workflow execution** - workflows always execute on Vercel production infrastructure
- **CORS enabled** - the production API has CORS headers configured
- **Auth via header** - requests include `Authorization: Bearer <token>` for authentication

This ensures:
- Workflows appear in Vercel Dashboard under AI → Workflows
- Full durability guarantees from Vercel Workflow DevKit
- Proper observability and monitoring
- Consistent behavior between local testing and production

## After Committing Code Changes

When you push code to main, Vercel auto-deploys. **Don't wait for the user** - proactively monitor and verify:

1. **Start monitoring immediately after push:**
   ```bash
   # Get the latest deployment for dev3000-www (NOT dev3000-mcp!)
   vercel ls dev3000-www --scope team_nLlpyC6REAqxydlFKbrMDlud | head -10

   # Monitor logs (use the specific deployment URL, not d3k.dev)
   vercel logs dev3000-XXXXX.vercel.sh --scope team_nLlpyC6REAqxydlFKbrMDlud
   ```

2. **Watch for deployment completion:**
   - New log activity indicates the new deployment is live
   - Status changes from "Building" to "Ready"

3. **Proceed with testing:**
   - Once deployed, start the workflow test immediately
   - Don't wait for user confirmation - be proactive

## Prerequisites

### 1. Ensure www Dev Server is Running

```bash
cd /Users/elsigh/src/vercel-labs/dev3000/www
pnpm dev
```

The local dev server must be running to serve the UI, even though workflows execute on production.

### 2. Verify User is Authenticated

Visit `http://localhost:3000/workflows` - you should see your workflows list. If redirected to sign-in, authenticate via Vercel OAuth.

## Test Workflow Creation

**IMPORTANT**: Always use d3k MCP tools for testing workflows. Do NOT use curl or manual API calls - use d3k's browser automation instead.

### Claude Quick Reference: Get Bypass Token

Before navigating to the workflow form, **you must get the bypass token**. Run this command:

```bash
# Get the bypass token value (copy just the value, not the variable name)
grep WORKFLOW_TEST_BYPASS_TOKEN /Users/elsigh/src/vercel-labs/dev3000/www/.env.local | cut -d'"' -f2
```

Then construct the URL: `http://localhost:3000/workflows/new?type=cloud-fix&team=team_aMS4jZUlMooxyr9VgMKJf9uT&project=prj_0ITI5UHrH4Kp92G5OLEMrlgVX08p&bypass=<PASTE_TOKEN_HERE>`

**Note**: The UI may not auto-fill the bypass field from the URL. If needed, use JavaScript to set it manually:
```javascript
const input = document.querySelector('input[placeholder*="bypass"]');
if (input) { input.value = '<TOKEN>'; input.dispatchEvent(new Event('input', {bubbles: true})); }
```

### Step 1: Start Monitoring Production Logs FIRST (BEFORE Triggering)

**⚠️ CRITICAL ORDER OF OPERATIONS:**
1. **FIRST** start monitoring production logs in the background
2. **THEN** navigate to the workflow form and click Start Workflow

The `vercel logs` command only streams logs that occur AFTER you start monitoring. If you start monitoring after clicking "Start Workflow", you will miss the initial API calls and workflow startup logs!

```bash
# STEP 1A: Get the latest deployment URL for dev3000-www
DEPLOYMENT=$(vercel ls dev3000-www --scope team_nLlpyC6REAqxydlFKbrMDlud | grep https | head -1 | awk '{print $2}')
echo "Will monitor: $DEPLOYMENT"

# STEP 1B: Start monitoring in background (do this BEFORE triggering!)
vercel logs $DEPLOYMENT --scope team_nLlpyC6REAqxydlFKbrMDlud 2>&1 &
echo "Monitoring started - NOW you can trigger the workflow"
```

### Step 2: Navigate to Workflow Form and Trigger

**Only do this AFTER monitoring is running!**

Use d3k browser automation (via `execute_browser_action` MCP tool):

**Before navigating**, read the bypass token from the environment:
```bash
# Read WORKFLOW_TEST_BYPASS_TOKEN from www/.env.local
grep WORKFLOW_TEST_BYPASS_TOKEN /Users/elsigh/src/vercel-labs/dev3000/www/.env.local
```

Then construct the URL with the token value:

```typescript
// Navigate to workflow form with all required parameters
// Replace <BYPASS_TOKEN> with the value from WORKFLOW_TEST_BYPASS_TOKEN in .env.local
execute_browser_action({
  action: "navigate",
  params: {
    url: "http://localhost:3000/workflows/new?type=cloud-fix&team=team_aMS4jZUlMooxyr9VgMKJf9uT&project=prj_0ITI5UHrH4Kp92G5OLEMrlgVX08p&bypass=<BYPASS_TOKEN>"
  }
})

// IMPORTANT: Wait 15-20 seconds for the project details to load from Vercel API
// The modal needs to fetch teams, projects, and branches before showing the Start button
// You can poll for readiness:
execute_browser_action({
  action: "evaluate",
  params: {
    expression: "document.body.innerHTML.includes('Start Workflow')"
  }
})

// Once the above returns true, click "Start Workflow" button
execute_browser_action({
  action: "evaluate",
  params: {
    expression: "Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('Start Workflow'))?.click()"
  }
})
```

### Step 3: Watch for Workflow Progress

Once you've triggered the workflow, your background log monitor will show progress. Look for these key milestones:

1. `[Workflow] Starting cloud fix workflow...` - Workflow started
2. `Cloning into '/vercel/sandbox'...` - Repo being cloned
3. `✅ Project dependencies installed` - npm/pnpm install complete
4. `✅ d3k started in detached mode` - d3k running in sandbox
5. `[Agent] Starting AI agent with d3k sandbox tools...` - AI agent running
6. `[Agent] Completed in X step(s)` - Agent finished

❌ **DO NOT TRUST THE UI**: UI showing "Writing code..." does NOT mean the workflow is running
✅ **ONLY TRUST PRODUCTION LOGS**: Use `vercel logs` CLI to verify actual execution

## How Local Dev Works Now

When you run the workflow from `localhost:3000`:

1. Browser calls `https://dev3000.ai/api/cloud/start-fix` directly (cross-origin)
2. Authorization header is included with the user's access token
3. Workflow executes on Vercel's production infrastructure
4. Production logs appear in Vercel CLI monitoring
5. Workflow appears in Vercel Dashboard under AI → Workflows

**Key code in `www/app/workflows/new-workflow-modal.tsx`:**
```typescript
// Always call the production API directly (dev3000.ai, not d3k.dev which redirects)
const apiUrl = "https://dev3000.ai/api/cloud/start-fix"

// Authorization header is included
const headers: HeadersInit = { "Content-Type": "application/json" }
headers.Authorization = `Bearer ${accessToken}`
```

## Monitor Logs Correctly

### CRITICAL: Production Logs Are the ONLY Source of Truth

❌ **DO NOT RELY ON**: UI status, local logs alone, or assumptions
✅ **ALWAYS VERIFY WITH**: Vercel CLI production logs

### Production Logs via Vercel MCP Tools (RECOMMENDED)

When Claude Code has the Vercel MCP configured, use these tools for easier debugging:

```typescript
// List recent deployments to find the correct one
mcp__vercel__list_deployments({
  projectId: "prj_kGnFvhhj2wowBx8zWEkciJnGMLFW",  // dev3000-www project
  teamId: "team_nLlpyC6REAqxydlFKbrMDlud"         // vercel team
})

// Get build logs for a specific deployment
mcp__vercel__get_deployment_build_logs({
  idOrUrl: "dpl_XXXXX",  // deployment ID from list_deployments
  teamId: "team_nLlpyC6REAqxydlFKbrMDlud",
  limit: 500
})

// Fetch a protected Vercel URL
mcp__vercel__web_fetch_vercel_url({
  url: "https://dev3000-xxxxx.vercel.sh/api/health"
})
```

**Key IDs for this project:**
- Team ID (Vercel): `team_nLlpyC6REAqxydlFKbrMDlud`
- Project ID (www): `prj_kGnFvhhj2wowBx8zWEkciJnGMLFW`
- Test Team (elsigh-pro): `team_aMS4jZUlMooxyr9VgMKJf9uT`
- Test Project: `prj_0ITI5UHrH4Kp92G5OLEMrlgVX08p`

### Production Logs via Vercel CLI (Fallback)

**Use CLI when MCP tools are not available:**

```bash
# Step 1: Get latest deployment URL for www production
DEPLOYMENT=$(vercel ls dev3000-www --scope team_nLlpyC6REAqxydlFKbrMDlud | grep https | head -1 | awk '{print $2}')
echo "Checking logs for: $DEPLOYMENT"

# Step 2: Monitor production logs for workflow activity (streams in real-time)
vercel logs $DEPLOYMENT --scope team_nLlpyC6REAqxydlFKbrMDlud 2>&1 | grep -i "workflow\|sandbox\|step"

# Step 3: If no output, check all recent logs (no grep filter)
vercel logs $DEPLOYMENT --scope team_nLlpyC6REAqxydlFKbrMDlud 2>&1 | tail -100
```

**Note:** `vercel logs` streams in real-time but auto-disconnects after 5 minutes. For longer monitoring, restart the command.

**What MUST appear in production logs for successful execution:**
- `[Workflow] Starting cloud fix workflow...` - Workflow initiated in production
- `[Step 0] Creating d3k sandbox...` - Sandbox creation started
- `[Step 0] Sandbox created successfully` - Sandbox is ready
- `[Step 0] Dev URL: https://sb-XXXXX.vercel.run` - Sandbox URL available
- `[Step 0] Executing MCP command inside sandbox...` - Running fix_my_app for CLS data
- `[Step 0] Saving initial report to blob storage...` - First report save (before agent)
- `[Step 0] Running AI agent with sandbox tools...` - **Agent runs in Step 0 with tool access**
- `[Agent] Starting AI agent with d3k sandbox tools...` - Agent initialization
- `[Agent] Completed in X step(s)` - Agent finished using tools
- `[Agent] Tool usage: {"readFile":3,"grepSearch":2,...}` - Tools the agent used
- `[Step 0] Agent analysis completed (N chars)` - Agent produced analysis
- `[Step 0] Report updated with agent analysis` - Final report saved
- `[Step 1] Using CLS data from sandbox` - Step 1 uses cached data (fast)
- `[Step 2] AI agent completed analysis with code access` - Uses Step 0 result
- `[Step 3] Compiling full report...` - Report finalization
- `[Step 4] Creating GitHub PR...` - PR creation (if enabled)

**If production logs show NOTHING**:
- ❌ Workflow was NOT created
- Possible causes:
  - Rewrite not working (check `next.config.ts`)
  - CORS issues with cross-origin request
  - Authentication token not included in request
- Solution: Check browser network tab for actual request destination

### AI Agent Tools (Step 0)

The AI agent in Step 0 has access to these d3k-specific tools for analyzing code in the sandbox:

| Tool | Description | Example Use |
|------|-------------|-------------|
| `readFile` | Read file contents from sandbox | Read component source code |
| `globSearch` | Find files by pattern | Find all `.tsx` files in `app/` |
| `grepSearch` | Search file contents | Find imports, function definitions |
| `listDirectory` | List directory contents | Explore project structure |
| `findComponentSource` | Map DOM element to React source | Trace CLS-causing elements to code |
| `writeFile` | Write/edit files in sandbox | Apply fixes directly |
| `getGitDiff` | Get git diff of changes | See what the agent modified |

**In production logs, you'll see:**
```
[Agent] Starting AI agent with d3k sandbox tools...
[Agent] Tool call: grepSearch({pattern: "className.*fixed", glob: "**/*.tsx"})
[Agent] Tool call: readFile({path: "app/components/Header.tsx"})
[Agent] Completed in 5 step(s)
[Agent] Tool usage: {"readFile":3,"grepSearch":2,"findComponentSource":1}
```

### Checking Final Workflow Results

After production logs confirm completion, you can check results via CLI:

```bash
# List all deployments for www production
vercel ls dev3000-www --scope team_nLlpyC6REAqxydlFKbrMDlud | head -20

# Or check the workflows page in browser (ONLY after production logs confirm completion)
# Navigate to: http://localhost:3000/workflows
```

**Remember**: Only check UI AFTER production logs confirm the workflow completed. UI status alone is unreliable.

## Checking Workflow Observability

Workflows should now appear in the Vercel Dashboard:

1. Go to https://vercel.com/vercel/dev3000-www
2. Navigate to **AI → Workflows** (not Observability → Workflows)
3. You should see your workflow runs listed

If workflows don't appear:
- Verify the workflow SDK (`workflow` package) is configured correctly
- Check that `withWorkflow()` wrapper is in `next.config.ts`
- Ensure the workflow is actually running on production (check logs)

You can also use the Workflow CLI to inspect runs:
```bash
npx workflow inspect runs --backend vercel --team vercel --project dev3000-www --env production
```

## Expected Timeline

Typical workflow execution:

| Step | Duration | What's Happening |
|------|----------|------------------|
| Step 0: Sandbox Creation | 1-2 min | Clone repo, install deps, start d3k |
| Step 0: CLS/Metrics Capture | 30-60 sec | Run fix_my_app for performance data |
| Step 0: Initial Report Save | 5-10 sec | Save first report to blob (before agent) |
| Step 0: AI Agent Analysis | 2-5 min | Agent uses tools (readFile, grep, etc.) in sandbox |
| Step 0: Report Update | 5-10 sec | Save agent analysis to blob |
| Step 1: Log Processing | 5-10 sec | Uses cached CLS data from Step 0 (fast) |
| Step 2: Analysis Pass-through | 5 sec | Uses agent result from Step 0 |
| Step 3: Final Report | 10-30 sec | Compile and save final report to Vercel Blob |
| Step 4: PR Creation | 10-30 sec | Create GitHub PR (optional, only if code changes) |
| **Total** | **4-10 min** | Full workflow execution |

**Key Architecture Note**: The AI agent now runs **inside Step 0** while the sandbox is active, giving it direct access to read/write files via tools. This is faster than the previous approach where the agent ran separately without code access.

**UI Timeout**: Frontend polls for 5 minutes, may show "timeout" error even if backend succeeds.

## Troubleshooting

### Issue: "No logs in production"
**Cause**: Workflow request not reaching production
**Fix**:
1. Check browser Network tab - verify request goes to `dev3000.ai`
2. Check for CORS errors in console
3. Verify Authorization header is present in the request

### Issue: "Workflow stuck in 'running' state"
**Cause**: Workflow exceeded 10-minute Vercel Function timeout
**Fix**: Check production logs for where it failed, may need to optimize MCP execution

### Issue: "UI shows timeout but backend succeeded"
**Cause**: UI 5-minute timeout < workflow 10-minute execution
**Fix**: This is expected, check workflows list page for actual status

### Issue: "Can't see production logs"
**Cause**: Looking at wrong deployment or wrong time range
**Fix**: Get latest deployment from `vercel ls` and check dashboard with correct timestamp

### Issue: "Workflows not appearing in Vercel Dashboard"
**Cause**: Workflows not reaching Vercel infrastructure
**Fix**:
1. Check Network tab - requests should go to `d3k.dev`
2. Verify the workflow completed successfully (check production logs)
3. Check Vercel Dashboard under **AI → Workflows** (not Observability)

### Issue: "MCP error: Cannot read properties of undefined (reading 'output')"
**Cause**: The MCP tool response format changed or there's a bug in parsing the response in the workflow code
**Symptoms**:
- Logs show: `[Step 1] Note: MCP error from Step 0: MCP execution error: Cannot read properties of undefined (reading 'output')`
- Workflow times out at 300 seconds
**Fix**: Check `www/app/api/cloud/fix-workflow/workflow.ts` for how MCP responses are parsed

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

echo "1. Checking www dev server..."
curl -s http://localhost:3000 > /dev/null && echo "✅ Dev server running" || echo "❌ Dev server not running"

echo "2. Getting latest www deployment..."
DEPLOYMENT=$(vercel ls dev3000-www --scope team_nLlpyC6REAqxydlFKbrMDlud | grep https | head -1 | awk '{print $2}')
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
# Get latest www deployment
DEPLOYMENT=$(vercel ls --scope team_nLlpyC6REAqxydlFKbrMDlud | grep dev3000 | head -1 | awk '{print $2}')

# Extract Dev URL
vercel logs $DEPLOYMENT --scope team_nLlpyC6REAqxydlFKbrMDlud 2>&1 | grep "Dev URL:" | tail -1
```

**From real-time monitoring:**
```bash
# Monitor logs and extract Dev URL as it appears
vercel logs --follow $DEPLOYMENT --scope team_nLlpyC6REAqxydlFKbrMDlud 2>&1 | grep -o "https://sb-[a-z0-9]*\.vercel\.run"
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

echo "1. Getting latest www deployment..."
DEPLOYMENT=$(vercel ls dev3000-www --scope team_nLlpyC6REAqxydlFKbrMDlud | grep https | head -1 | awk '{print $2}')
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

## CLS Test Case Reference: tailwind-plus-transmit

This section documents the expected CLS behavior for the primary test project used in cloud workflow testing.

### Test Project Details

- **Repository**: https://github.com/elsigh/tailwind-plus-transmit
- **CLS-causing component**: `src/app/(main)/layout.tsx` (`LayoutCLSBlock` function)
- **Vercel Project ID**: `prj_0ITI5UHrH4Kp92G5OLEMrlgVX08p`
- **Team**: `team_aMS4jZUlMooxyr9VgMKJf9uT` (elsigh-pro)

### How the CLS Issue Works

The `LayoutCLSBlock` component intentionally causes massive CLS by:
1. Rendering `null` initially (no space reserved)
2. After 500ms delay, rendering a 200vh tall promotional banner
3. This pushes ALL page content down, causing massive layout shift

```tsx
// src/app/(main)/layout.tsx - LayoutCLSBlock function
function LayoutCLSBlock() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setShow(true), 500)  // 500ms delay
    return () => clearTimeout(timer)
  }, [])

  if (!show) return null  // ❌ No space reserved - causes CLS!

  return (
    <div style={{ height: '200vh' }} className="bg-gradient-to-b from-red-600 ...">
      {/* 200vh tall promotional banner */}
    </div>
  )
}
```

**Key**: This test case causes CLS at **ALL viewport sizes** (no viewport-dependent behavior).

### Local Baseline Test Results (December 2024)

Tested on Macbook Pro 14" with d3k v0.0.126:

| Metric | Before Fix | After Fix |
|--------|------------|-----------|
| **CLS Score** | 0.3175 | 0 |
| **Grade** | POOR | GOOD |
| **Shift Count** | 1 | 0 |
| **Shift Time** | ~588-659ms | N/A |

**Viewport used**: 1512x857 @ 2x devicePixelRatio

### The Fix

The standard fix is to use `visibility: hidden` instead of conditional rendering:

```tsx
// BEFORE (causes CLS):
if (!show) return null
return (
  <div style={{ height: '200vh' }} ...>

// AFTER (no CLS):
return (
  <div style={{ height: '200vh', visibility: show ? 'visible' : 'hidden' }} ...>
```

This reserves the 200vh space from initial render, preventing content shift when the banner appears.

### Agent Prompt (Cloud Workflow)

The cloud workflow uses this system prompt for the AI agent:

```
You are a CLS fix specialist. Fix the layout shift issue efficiently.

## CRITICAL: You MUST write a fix!
Your goal is to WRITE CODE that fixes the CLS issue, not just analyze it.
You have limited steps - be efficient and focused.

## Workflow (4-6 steps max):
1. **diagnose** - See what's shifting (1 step)
2. **Find code** - Search for the shifting element in code (1-2 steps)
3. **writeFile** - FIX THE CODE (1 step) ← THIS IS REQUIRED!
4. **diagnose** - Verify fix worked (1 step)

## CLS Fix Patterns (use these!):
- Conditional rendering → Use `visibility: hidden` instead of `return null`
- Delayed content → Reserve space with min-height or fixed dimensions
- Elements shifting down → Add height/min-height from initial render
- Images → Add explicit width/height

Step limit: 15 (enough for diagnose + find + read + write + verify)
```

### Expected Cloud Workflow Results

The cloud workflow should achieve results similar to local testing:

| Metric | Expected Before | Expected After | Target |
|--------|-----------------|----------------|--------|
| **CLS Score** | ~0.32 | ~0 | ≤0.1 (GOOD) |
| **Result** | POOR | GOOD | improved |

### Verification Commands

```bash
# Check CLS in local d3k logs:
grep -E "Detected.*CLS" ~/.d3k/logs/tailwind-plus-transmit-*.log | tail -5

# Expected output BEFORE fix:
# [CDP] Detected 1 layout shifts (CLS: 0.3175)

# Expected output AFTER fix:
# (No "Detected" lines - CLS is 0)

# Check CLS observer is running:
grep "CLS observer installed" ~/.d3k/logs/tailwind-plus-transmit-*.log | tail -3
```

### Cloud Tarball Configuration

The d3k tarball used in cloud sandboxes is configured in `www/lib/cloud/d3k-sandbox.ts`:

```typescript
// Current tarball (check for latest):
const d3kTarballUrl = "https://github.com/vercel-labs/dev3000/releases/download/v0.0.127-canary-viewport2/dev3000-0.0.127-canary.tgz"
```

### Cloud Headless Viewport

The cloud sandbox uses headless Chrome with viewport configured in `src/cdp-monitor.ts`:

```typescript
if (this.headless) {
  await this.sendCDPCommand("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
  })
}
```

**Note**: The new test case (LayoutCLSBlock) causes CLS at all viewport sizes, so viewport configuration is less critical than before. However, matching the local viewport (1512x857) would give the most comparable results.

### Updating the Tarball

When updating viewport or other d3k configuration:
1. Update `src/cdp-monitor.ts` with changes
2. Run `pnpm build` (MUST build before packing!)
3. Run `pnpm pack --pack-destination /tmp/package`
4. Create GitHub release with the tarball
5. Update `d3k-sandbox.ts` with new tarball URL
6. Commit and push to deploy

---

## Summary

**Key Points:**
1. ✅ Frontend calls `https://dev3000.ai/api/cloud/start-fix` directly
2. ✅ Authorization header is included for authentication
3. ✅ Monitor production logs (Vercel CLI) - NOT local logs
4. ✅ Workflows appear in Vercel Dashboard under AI → Workflows
5. ✅ Test Dev URLs (if sandbox created) - Verify sandbox is accessible

**If production logs are empty**, workflow request didn't reach production - check Network tab for CORS/auth errors!

**If Dev URL returns 502**, the dev server isn't binding to 0.0.0.0 for external access.
