# Vercel Workflows SDK Bundler Issue

## Problem Summary

The Vercel Workflows SDK bundler is rejecting workflows that use common packages (`ai`, `@vercel/blob`) due to their dependencies on Node.js built-in modules. This appears to be a limitation of the beta Workflows SDK.

## Error Details

**Build fails with 116 errors** like:
```
Cannot use Node.js module 'node:module' in workflow functions. Move this module to a step function.
Cannot use Node.js module 'node:path' in workflow functions. Move this module to a step function.
Cannot use Node.js module 'node:buffer' in workflow functions. Move this module to a step function.
... (113 more similar errors)
```

**Affected files:**
- `mcp-server/app/api/cloud/check-pr/route.ts`
- `mcp-server/app/api/cloud/fix-workflow/route.ts` (likely also broken)

**Failed deployments:**
- https://dev3000-d9ugc3sli.vercel.sh (latest)
- https://dev3000-r18ixg6bx.vercel.sh
- https://dev3000-7jkp9qcw4.vercel.sh
- https://dev3000-pybrh4m3d.vercel.sh

## Problematic Dependencies

The workflow bundler rejects these packages because they depend on Node.js built-in modules:

1. **`ai` package (Vercel AI SDK)**
   - Uses `undici` for HTTP requests
   - `undici` requires: `node:net`, `node:http`, `node:stream`, `node:crypto`, `node:buffer`, etc.

2. **`@vercel/blob`**
   - Uses Node.js built-in modules for filesystem and crypto operations

3. **`fetch()` via undici**
   - Modern fetch implementation traces back to Node.js modules

## Attempted Fixes (All Failed)

### Attempt 1: Dynamic imports in step functions
```typescript
async function uploadReportStep(report: string) {
  "use step"
  const { put } = await import("@vercel/blob")  // Still analyzed at build time
  return put(filename, report, { access: "public" })
}
```
**Result:** Failed - bundler still analyzed the dynamic import

### Attempt 2: Separate module with static imports
Created `steps.ts` with all implementations, imported via:
```typescript
import * as steps from "./steps"
```
**Result:** Failed - bundler traced through module dependencies

### Attempt 3: Wrapper functions with runtime dynamic imports
```typescript
async function uploadReportStep(report: string, owner: string, repo: string, pr: string) {
  "use step"
  const { uploadReport } = await import("./steps")
  return uploadReport(report, owner, repo, pr)
}
```
**Result:** Failed - bundler still detected Node.js modules

## Root Cause Analysis

The Vercel Workflows SDK bundler performs **aggressive static analysis** at build time that:
- Traces ALL imports, including dynamic ones
- Follows imports through external modules
- Rejects ANY Node.js built-in module usage, even:
  - Inside step functions marked with `"use step"`
  - Inside dynamically imported modules
  - Through transitive dependencies

This means packages that work fine in regular serverless functions fail when used in workflows.

## Impact

- **check-pr workflow**: Never successfully deployed since creation
- **fix-workflow**: Likely also broken but not recently tested
- **Integration webhook**: Cannot trigger PR checks
- **Deployments**: Failing since commit fc640ce

## Code Structure

**Working pattern (that we can't use):**
```typescript
import { put } from "@vercel/blob"
import { createGateway, generateText } from "ai"

export async function myWorkflow() {
  "use workflow"

  // These packages can't be used because they depend on Node.js modules
  const gateway = createGateway(...)
  const blob = await put(...)
}
```

**What we need (but doesn't work):**
```typescript
// No way to use these packages in workflows currently
```

## Questions for Vercel Team

1. **Is this a known limitation** of the beta Workflows SDK?

2. **Are there plans to support** packages like `ai` and `@vercel/blob` that depend on Node.js built-in modules?

3. **Is there a workaround** we're missing? The documentation suggests dynamic imports in step functions should work, but they don't bypass the bundler analysis.

4. **Should we file a bug report** or is this expected behavior?

5. **Recommended approach:**
   - Temporarily disable workflow-based features?
   - Reimplement as standard serverless functions?
   - Wait for SDK updates?

## Repository Context

**Branch:** `workflow-bundler-issue`
**Repo:** https://github.com/vercel-labs/dev3000
**Latest failing commit:** bbcbeac

You can trigger a deployment to reproduce the issue by deploying this branch.

## Test Instructions

To reproduce:

1. Checkout this branch: `git checkout workflow-bundler-issue`
2. Deploy to Vercel: The build will fail during workflow bundling
3. Check build logs for the 116 "Cannot use Node.js module" errors

Or view existing failed deployment:
```bash
vc logs https://dev3000-d9ugc3sli.vercel.sh --output raw
```
