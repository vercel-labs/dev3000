# dev3000 Cloud CLI Vision

## Overview

A CLI tool that uses Vercel Sandbox to analyze and fix issues in any web project.

## User Experience

```bash
# From within your project directory
cd ~/my-nextjs-app
pnpm dlx d3k-cloud fix

# Or via d3k itself
d3k cloud fix
```

## What It Does

1. **Project Detection**
   - Reads `package.json` to understand the project
   - Checks `.git` to get repository URL and current branch
   - Detects framework (Next.js, Vite, etc.)
   - Identifies dev server command from package.json scripts

2. **Sandbox Creation**
   - Creates Vercel Sandbox from the detected git repo + branch
   - Installs dependencies
   - Starts the dev server on port 3000
   - Exposes public URL via `sandbox.domain(3000)`

3. **MCP Tool Execution in Sandbox**
   - Connects to MCP server running in sandbox
   - Runs `crawl_my_site` against the sandboxed dev server
   - Identifies errors, console warnings, accessibility issues
   - Runs `fix_my_app` to generate fixes
   - Applies fixes in the sandbox

4. **PR Creation**
   - If fixes were successful in sandbox:
   - Creates a new branch (e.g., `d3k-cloud-fixes-{timestamp}`)
   - Commits the changes
   - Pushes to GitHub
   - Opens a PR with detailed description of fixes

## Architecture

```
User's Machine                    Vercel Sandbox
─────────────────                ─────────────────
│                                │
│  $ d3k cloud fix               │  1. Clone repo
│                                │  2. pnpm install
│  ↓                             │  3. pnpm dev
│                                │  4. Start MCP server
│  Detect project:               │
│  - repo URL from .git          │  ↓
│  - branch from .git            │
│  - dev cmd from package.json   │  Public URL:
│                                │  https://xyz.vercel.sh
│  ↓                             │
│                                │  ↓
│  Create Sandbox ──────────────>│
│                                │  MCP Server running
│  ↓                             │  Tools: crawl_my_site,
│                                │         fix_my_app
│  Connect to MCP in sandbox     │
│                                │  ↓
│  Run tools:                    │
│  1. crawl_my_site              │  Analyze errors
│  2. fix_my_app                 │  Generate fixes
│                                │  Apply to files
│  ↓                             │
│                                │  ↓
│  Get fixes from sandbox        │
│  Apply locally                 │
│  Create PR                     │
│                                │
```

## Implementation Plan

### Phase 1: Local CLI Tool

Create `src/commands/cloud-fix.ts`:
- Detect project from cwd
- Extract repo URL, branch, dev command
- Create sandbox with project
- Start dev server in sandbox
- Report sandbox URL

### Phase 2: Sandbox MCP Integration

Update sandbox manager to:
- Start MCP server in sandbox
- Expose MCP tools endpoint
- Connect from CLI to sandbox MCP server

### Phase 3: Tool Execution

- Run `crawl_my_site` with sandbox URL
- Collect errors and issues
- Run `fix_my_app` with findings
- Apply fixes in sandbox
- Verify fixes work

### Phase 4: PR Creation

- Extract changed files from sandbox
- Create branch locally
- Apply changes
- Commit and push
- Use GitHub API to create PR

## Example Flow

```bash
$ cd ~/my-project
$ d3k cloud fix

🔍 Detecting project...
  Repository: github.com/myorg/my-project
  Branch: main
  Framework: Next.js
  Dev command: pnpm dev

🚀 Creating Vercel Sandbox...
  Sandbox ID: sbx_abc123
  Cloning repository...
  Installing dependencies...
  Starting dev server...
  ✅ Dev server ready: https://sbx-abc123.vercel.sh

🔧 Analyzing with MCP tools...
  Running crawl_my_site...
    Found 3 pages
    Detected 2 errors
    Detected 5 console warnings

  Running fix_my_app...
    Generated 4 fixes
    Applying fixes...
    ✅ All fixes applied successfully

✅ Verifying fixes...
  Re-crawling site...
  ✅ 2 errors resolved
  ✅ 3 warnings resolved
  ⚠️  2 warnings remain

📤 Creating pull request...
  Branch: d3k-cloud-fixes-20250103-204400
  Pushing to GitHub...
  Creating PR...
  ✅ PR created: https://github.com/myorg/my-project/pull/123

🎉 Done! Check your PR for the proposed fixes.
```

## Benefits

1. **Safe Testing**: All fixes are tested in isolated sandbox before PR creation
2. **Any Project**: Works with any framework, any repo
3. **Automatic Detection**: No configuration needed
4. **CI/CD Ready**: Can run in automation to continuously improve code
5. **Verifiable**: Changes are proven to work before being proposed

## Future Enhancements

- Support for multiple frameworks (Rails, Django, etc.)
- Custom MCP tool selection
- Integration with Vercel Workflow for long-running analyses
- Scheduled runs via cron
- Integration with issue trackers (Linear, GitHub Issues)
