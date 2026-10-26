# d3k

d3k gives your coding agent a managed browser and a shared timeline of server output, browser console messages, exceptions, network requests, and interactions.

Install the skill, then ask your agent to run the project, reproduce an issue, and inspect what happened:

```bash
pnpm dlx skills add vercel-labs/dev3000 --skill d3k
```

> Use d3k to run this project and help me debug the checkout flow.

The skill owns a small background JavaScript runtime. No global d3k binary or terminal dashboard is required. Node.js 24+, pnpm, and Chrome are needed. The installed skill runs the JavaScript runtime under Node; Bun is only used for development in this repository.

## Try the source

Until this runtime is released, use the helper from this checkout. Run these commands from the **app you want to debug**, replacing `/path/to/dev3000` with this checkout:

```bash
node /path/to/dev3000/skills/d3k/scripts/runtime.mjs portless status
# One-time administrator authorization, if setup is required:
node /path/to/dev3000/skills/d3k/scripts/runtime.mjs portless setup
node /path/to/dev3000/skills/d3k/scripts/runtime.mjs start
```

Keep `start` in a retained background process session. The helper runs checkout source with Bun. An installed skill can target this source by setting `D3K_RUNTIME_ROOT=/path/to/dev3000`.

Canonical Portless HTTPS must be ready before starting the server or browser. The runtime uses a port-free URL such as `https://my-app.localhost`, with a project-stable Chrome profile for authentication. It fails before launching the app if setup is incomplete.

## Read evidence

The commands below use `d3k-runtime`, the package's JavaScript entrypoint. In a checkout, substitute `node /path/to/dev3000/skills/d3k/scripts/runtime.mjs`.

```bash
d3k-runtime status
d3k-runtime browser snapshot -i
d3k-runtime browser click @e2
d3k-runtime events --session <sessionId> --after <cursor>
d3k-runtime events --after <cursor> --source server
d3k-runtime events --after <cursor> --level error
d3k-runtime stop
```

Before reproducing an issue, retain the `sessionId` and `cursor` from `status`. Read events after that cursor, continuing while `hasMore` is true. A new session returns `reset: true`; `dropped` reports events evicted from the buffer. Filtered queries advance through examined events, so keep the original cursor when comparing multiple views of an interval.

Server and browser events share sequence numbers assigned at collection time. Network events retain CDP request IDs, and exceptions retain stack traces. Chronological proximity to a server line does not establish causation.

The timeline holds at most 5,000 events or 8 MiB. Individual records are capped. No log files are written by the skill runtime, and its evidence disappears on exit. Request headers and bodies are omitted; URL query values are redacted. Console output and server messages can still contain application secrets.

Only browser profile and session discovery data persist under `~/.d3k/<project>/`. Local control uses authenticated IPC, not an HTTP listener on the network. Automatic screenshots are off; use `browser screenshot <absolute-path>` when needed.

## Server and browser ownership

The runtime detects the project's package manager and `dev` script. Use `start --command '<dev command>'` for other projects or custom servers. Use `--headless` for CI and `--servers-only` when browser monitoring is intentionally unwanted.

Chrome's sandbox stays enabled in both headed and headless modes. If a constrained container cannot support Chrome sandboxing, explicitly set `D3K_CHROME_NO_SANDBOX=1` when starting the runtime. This disables browser isolation and emits a startup warning; use it only in an appropriately isolated environment. d3k does not retry without the sandbox automatically.

The agent and user share the same monitored browser. Do not launch a second server or substitute another browser profile during a session. Leave the runtime running when handing the browser to the user for testing.

## Compatibility

`d3k` and `dev3000` retain the previous local CLI, including optional terminal UI and file-backed logging. The skill uses `d3k-runtime` instead. The two runtimes must not own the same project simultaneously. The npm package now ships JavaScript instead of platform-specific d3k binaries.

The website is a public landing page and changelog. Hosted dev agents, skill runners, workflow execution, sandboxes, OAuth, teams, admin controls, report/blob storage, and CLI telemetry have been removed. Existing remote deployments and stored data are not deleted by a source change.

## Development

```bash
bun install
bun run lint
bun run typecheck
bun run test
bun run canary
```

`bun run canary` builds, packs, installs, and smoke-tests the JavaScript package locally. It does not publish to npm. Use `./scripts/release.sh` from a clean `main` checkout to prepare a stable release; GitHub Actions publishes through Trusted Publishing.

MIT
