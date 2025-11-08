# dev3000 Vercel Integration Setup

This guide explains how to set up the dev3000 Vercel Integration to automatically verify PR changes and check performance on your Vercel preview deployments.

## Overview

The dev3000 integration automatically:
- Detects when a PR has a Vercel preview deployment
- Analyzes which pages were affected by the PR changes
- Verifies that the PR does what it claims to do
- Checks performance metrics for affected pages
- Generates a comprehensive report
- Optionally posts results to the PR (if GitHub token is configured)

## Quick Setup (No Token Required)

The integration works immediately without any manual configuration! Just:

1. Deploy the dev3000 MCP server to Vercel
2. Add the webhook URL to your project's Vercel Integration

### Step 1: Deploy MCP Server

```bash
cd mcp-server
vc deploy --prod
```

Note your deployment URL (e.g., `https://dev3000-mcp.vercel.sh`)

### Step 2: Configure Vercel Integration

1. Go to your Vercel project settings
2. Navigate to "Integrations" → "Webhooks"
3. Click "Add Webhook"
4. Configure:
   - **URL**: `https://your-mcp-server.vercel.sh/api/integration/webhook`
   - **Events**: Select `deployment.created`
   - **Projects**: Select the projects you want to monitor

That's it! The integration will now run on every PR deployment.

## How It Works

### Without GitHub Token (Default)

When a PR deployment is created:

1. Webhook receives deployment event from Vercel
2. Extracts GitHub metadata (owner, repo, branch, PR number)
3. Fetches PR details and changed files
4. Triggers AI-powered verification workflow
5. Generates report and uploads to Vercel Blob
6. Logs report URL to Vercel deployment logs

**To view results**: Check the Vercel deployment logs for your MCP server. Look for lines like:
```
[Webhook] Workflow completed: success
[Webhook] Report URL: https://oeyjlew0wdsxgm6o.public.blob.vercel-storage.com/pr-reports/...
[Webhook] Skipping GitHub comment (no GITHUB_TOKEN set)
```

### With GitHub Token (Optional)

If you want results posted directly to PRs:

1. Create a GitHub Personal Access Token:
   - Go to https://github.com/settings/tokens
   - Click "Generate new token (classic)"
   - Select scopes: `repo` (full control)
   - Copy the token

2. Add token to your MCP server:
   ```bash
   cd mcp-server
   vc env add GITHUB_TOKEN
   # Paste your token when prompted
   ```

3. Redeploy:
   ```bash
   vc deploy --prod
   ```

Now the integration will:
- Post a comment on the PR with results
- Set a GitHub check status (✅ or ❌)
- Include the full report URL in the comment

## CLI Usage (Manual Testing)

You can manually verify any PR using the CLI:

```bash
# Auto-detect PR from current branch
dev3000 cloud check-pr

# Specify PR number
dev3000 cloud check-pr 123

# Specify repo (useful for monorepos)
dev3000 cloud check-pr 123 --repo owner/repo

# Debug mode
dev3000 cloud check-pr --debug
```

**Requirements for CLI**:
- Must be run from a git repository with GitHub remote
- Requires `gh` CLI to be installed and authenticated
- Requires `vc` CLI to be installed and authenticated
- PR must have a Vercel preview deployment

## What Gets Verified

### 1. Page Detection

The workflow intelligently detects affected pages from:
- Next.js pages directory (`/pages/*.tsx`)
- Next.js app directory (`/app/*/page.tsx`)
- SvelteKit routes (`/routes/*.svelte`)
- URLs mentioned in the PR description

### 2. AI Verification

Claude Sonnet 4 analyzes:
- Whether the PR does what it claims to do
- Console errors or JavaScript errors
- Network errors or failed requests
- Visual rendering issues
- Unexpected behavior

### 3. Performance Analysis

Checks each page for:
- Load time (fast <500ms, acceptable <2s, slow >2s)
- Resource count
- Total payload size
- Identifies slow pages for optimization

### 4. Report Generation

Creates a markdown report with:
- Executive summary
- Detailed findings per page
- Performance metrics
- Recommendations
- Links to preview deployment

## Report Format

Example report structure:

```markdown
# PR Verification Report

**PR**: #123 - Add user dashboard
**Project**: owner/repo
**Preview URL**: https://preview.vercel.app

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

## Configuration Options

### Environment Variables

Add to your MCP server deployment:

```bash
# Optional: Enable GitHub integration
GITHUB_TOKEN=ghp_...

# Required: AI Gateway for verification
AI_GATEWAY_API_KEY=your_key

# Required: Blob storage for reports
BLOB_READ_WRITE_TOKEN=your_token
```

### Workflow Timeout

Default timeout is 5 minutes. To adjust:

Edit `/mcp-server/app/api/cloud/check-pr/route.ts`:
```typescript
export const maxDuration = 300 // 5 minutes (default)
```

## Troubleshooting

### Integration doesn't trigger

1. Check webhook configuration in Vercel project settings
2. Verify webhook URL is correct
3. Ensure `deployment.created` event is selected
4. Check MCP server logs for errors

### Report URL not generated

1. Verify `BLOB_READ_WRITE_TOKEN` is set in MCP server
2. Check Vercel Blob storage quota
3. Review MCP server logs for upload errors

### PR detection fails

1. Ensure PR has GitHub metadata in Vercel deployment
2. For private repos without token: PR details may be limited
3. Check that branch name matches GitHub branch

### Performance metrics missing

1. Verify preview URL is accessible
2. Check for CORS issues in preview deployment
3. Review crawl results in workflow logs

## Advanced Usage

### Custom Page Patterns

To support additional frameworks, edit the page detection patterns in:
`/mcp-server/app/api/cloud/check-pr/route.ts`

```typescript
const pagePatterns = [
  /\/pages\/(.*)\.(tsx?|jsx?)$/,  // Next.js pages
  /\/app\/(.*)\/(page|route)\.(tsx?|jsx?)$/,  // Next.js app
  /\/routes\/(.*)\.(tsx?|jsx?)$/,  // SvelteKit
  // Add your custom patterns here
]
```

### Custom Performance Thresholds

Edit performance check function:

```typescript
const performanceCategories = {
  fast: loadTime < 500,      // Adjust threshold (ms)
  acceptable: loadTime < 2000,  // Adjust threshold (ms)
  slow: loadTime >= 2000
}
```

## GitHub Action Integration

Want to trigger verification on PR events? Create `.github/workflows/pr-check.yml`:

```yaml
name: PR Check
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Wait for Vercel deployment
        run: sleep 60  # Wait for deployment to be ready

      - name: Install dev3000
        run: npm install -g dev3000

      - name: Run PR verification
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: dev3000 cloud check-pr ${{ github.event.pull_request.number }}
```

## Support

For issues or questions:
- GitHub Issues: https://github.com/vercel-labs/dev3000/issues
- Documentation: https://github.com/vercel-labs/dev3000

## Next Steps

1. Test with a sample PR to verify setup
2. Review the first few reports to ensure accuracy
3. Consider adding GitHub token for automatic PR comments
4. Customize performance thresholds for your project
5. Submit to Vercel Integration Marketplace (coming soon)
