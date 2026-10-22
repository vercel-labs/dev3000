# Contributing to d3k

Use Bun and Node.js 24+. Install dependencies with `bun install`.

The skill in `skills/d3k/` is the primary user interface. Its JavaScript helper runs the source runtime in `src/runtime/`. That runtime owns the dev server, browser, and bounded in-memory evidence timeline. Browser collection lives in `src/cdp-monitor.ts`; the older CLI remains for compatibility.

`www/` contains only the public landing page and changelog. Do not introduce hosted execution, authentication, sandbox management, or storage APIs there.

Run the local site through the skill runtime from `www/`, after checking canonical Portless readiness. Do not start another dev server alongside it.

Before submitting changes:

```bash
bun run lint
bun run typecheck
bun run test
```

For changes under `src/`, also run `bun run canary`. It installs the local JavaScript package without publishing. Exercise the changed browser flow in the monitored browser and inspect its evidence interval. Include relevant validation and any limitations in the PR.

When reporting a bug, include reproduction steps, runtime version, OS, framework, and relevant evidence. Avoid sharing tokens, cookies, or application secrets from console output.
