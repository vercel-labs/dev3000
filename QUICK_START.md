# dev3000 Vercel Integration - Quick Start

AI-powered PR verification that runs automatically on every Vercel preview deployment.

## What It Does

- ✅ Verifies PRs do what they claim to do (using Claude Sonnet 4)
- ⚡ Checks performance of affected pages
- 🔍 Detects console errors and issues
- 📊 Generates detailed reports
- 🤖 100% automated - no manual work required

## 2-Minute Setup

### Step 1: Add Webhook to Your Vercel Project

1. Go to your Vercel project → **Settings** → **Git**
2. Scroll to **Deploy Hooks** section
3. Click **Create Hook**:
   - **Hook Name**: `dev3000-pr-check`
   - **Git Branch**: Leave as "main" (it monitors all branches)
   - Click **Create Hook**
4. Copy the generated webhook URL
5. Go to **Settings** → **Integrations** → **Webhooks**
6. Click **Add Webhook**:
   - **URL**: `https://dev3000-mcp.vercel.sh/api/integration/webhook`
   - **Events**: Select **"Deployment Created"**
   - **Secret**: Paste any random string (e.g., copy the deploy hook URL you just created)
   - Click **Save**

### Step 2: Test It

1. Create a test PR in your repo
2. Wait for Vercel to create preview deployment
3. Check results in Vercel logs: https://vercel.com/vercel/dev3000-mcp/logs
4. Look for `[Webhook] Report URL: https://...` in the logs

**That's it!** Every PR will now be automatically verified.

## Optional: Enable PR Comments

Want results posted directly to your PRs as comments?

```bash
cd /path/to/dev3000/mcp-server
vc env add GITHUB_TOKEN
# Paste your GitHub token (create at https://github.com/settings/tokens)
# Select scope: repo (full control)
vc deploy --prod
```

Now results will appear as PR comments with GitHub check status.

## CLI Usage (Manual Testing)

You can also run checks manually:

```bash
# Auto-detect PR from current branch
dev3000 cloud check-pr

# Specify PR number
dev3000 cloud check-pr 123

# Specify repo
dev3000 cloud check-pr 123 --repo owner/repo
```

## How It Works

1. **Webhook triggers** when Vercel creates preview deployment
2. **Detects affected pages** by analyzing changed files
3. **Crawls preview URL** to capture screenshots and check console
4. **AI verification** uses Claude Sonnet 4 to verify PR claims
5. **Performance analysis** checks load time, resources, payload size
6. **Generates report** with findings and recommendations
7. **Posts results** (if GitHub token is configured)

## Example Report

```markdown
# PR Verification Report

**PR**: #42 - Add user dashboard
**Preview**: https://my-app-git-feature.vercel.app

## Summary
✅ All checks passed - PR changes work as described

## Verification Results
- ✅ Dashboard loads without errors
- ✅ User data displays correctly
- ✅ Navigation works as expected

## Performance Analysis
- ⚡ Fast: /dashboard (342ms)
- ⚡ Fast: /profile (458ms)
- ⚠️ Slow: /analytics (2.3s) - Consider optimization

## Recommendations
1. Optimize /analytics page load time
2. Consider lazy loading chart components
```

## Troubleshooting

### Webhook doesn't trigger
- Check webhook configuration in Vercel settings
- Verify URL is correct: `https://dev3000-mcp.vercel.sh/api/integration/webhook`
- Ensure "Deployment Created" event is selected

### Can't find report
- Check MCP server logs: https://vercel.com/vercel/dev3000-mcp/logs
- Search for `[Webhook]` messages
- Report URL will be logged even without GitHub token

### PR comments not posting
- Verify `GITHUB_TOKEN` is set in MCP server environment
- Check token has `repo` scope
- Ensure MCP server has been redeployed after adding token

## Support

- GitHub Issues: https://github.com/vercel-labs/dev3000/issues
- Full Docs: See `INTEGRATION_SETUP.md` for advanced configuration
