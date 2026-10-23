---
name: d3k
description: Run and debug a local web app with a managed browser and a shared server/browser evidence timeline. Use when asked to develop, test, or reproduce a browser issue with d3k.
---

# d3k

Own the project's dev server and monitored browser through a small background runtime. No global d3k installation is needed. Evidence stays in bounded memory; browser authentication stays in the project Chrome profile.

Use `node <skill-directory>/scripts/runtime.mjs` as `runtime` below, from the **target project root**. In a development checkout the helper runs the source with Bun; installed skills use the JavaScript package through `pnpm dlx` (Node.js 24+ and pnpm required). To try unreleased source from another project, set `D3K_RUNTIME_ROOT` to the dev3000 checkout. Do not use a previously published package to test unreleased changes.

## Prepare

1. Run `runtime portless status`. Canonical HTTPS must be ready (`canonical: true`, `serviceInstalled: true`, `setupRequired: false`) before starting the app or browser. If needed run `runtime portless setup`, wait for the one-time administrator authorization, then check again. Stop if setup is unavailable; never silently substitute direct localhost.
2. Run `runtime status`. Reuse a ready runtime for this project. If it is starting, wait for readiness. Do not start another dev server. A legacy d3k session must be stopped before switching runtimes.
3. Start `runtime start` in a retained background tool session. Keep its process handle. The runtime detects the package manager and `dev` script; use `--command '<dev command>'` when needed. Poll `runtime status` until `ready: true` and `browserConnected: true` with a port-free `https://...localhost` URL. Inspect `runtime events` if startup fails while the runtime is still alive, and the retained process output if it exits.

## Reproduce and inspect

- For “let me test,” give the user the app URL and leave the browser running while they reproduce the issue.
- For autonomous debugging, drive the same browser with `runtime browser snapshot -i`, `runtime browser click @e2`, and other agent-browser commands. The runtime supplies the CDP connection; never open a separate browser or profile.
- Before a reproduction, read `runtime status` and keep its `sessionId` and `cursor`.
- After the interaction, read `runtime events --session <id> --after <cursor>`. Server output, console messages, exceptions, network requests, and navigation share sequence numbers. Requests and responses carry CDP request IDs; adjacent server lines are chronological context, not proof of causation.
- Continue from the returned `cursor` while `hasMore` is true. Use `--limit 1..500`, `--source server|browser|runtime`, or `--level error` for focused reads. For error context, read the unfiltered interval as well. Filters advance the cursor through examined events; retain the original cursor if you need another view of the same interval.
- `reset: true` means the runtime restarted. `dropped` reports evicted events. Never claim complete evidence across either gap. Replay the interaction if necessary.
- Fix the code and repeat the same interaction, then inspect the new interval. Keep the runtime alive across edits.

## Lifecycle

Keep the runtime's project-stable profile for sign-in state. Use `--headless` for CI or when requested; `--servers-only` deliberately omits the browser. Automatic screenshots and persistent log files are off; request a screenshot through `runtime browser screenshot <absolute-path>` when visual evidence is needed.

Stop with `runtime stop` or the retained process handle when asked. Leaving the browser open for user testing means leaving the runtime alive. Events are lost when it exits; only profile and session discovery data persist. Console/server text may contain application secrets; inspect selectively and avoid copying sensitive values into reports.
