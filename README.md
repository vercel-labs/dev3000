# d3k

d3k gives your coding agent a managed browser and a shared timeline of server output, browser console messages, exceptions, network requests, and interactions.

Install the skill, then ask your agent to run the project, reproduce an issue, and inspect what happened:

```bash
pnpm dlx skills add vercel-labs/dev3000 --skill d3k
```

> Use d3k to run this project and help me debug the checkout flow.

The skill owns a small background JavaScript runtime. No global d3k binary is required. Node.js 24+, pnpm, and Chrome are needed. The installed local skill runs under Node; repository development and the experimental sandbox launcher also require Bun.

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

`d3k`, `dev3000`, and `d3k-runtime` expose the same commands. The examples below use `d3k`. In a checkout, substitute `node /path/to/dev3000/skills/d3k/scripts/runtime.mjs`.

```bash
d3k status
d3k browser snapshot -i
d3k browser click @e2
d3k events --session <sessionId> --after <cursor>
d3k events --after <cursor> --source server
d3k events --after <cursor> --level error
d3k logs -n 100 --type browser
d3k errors --context --json
d3k stop
```

Before reproducing an issue, retain the `sessionId` and `cursor` from `status`. Read events after that cursor, continuing while `hasMore` is true. A new session returns `reset: true`; `dropped` reports events evicted from the buffer. Filtered queries advance through examined events, so keep the original cursor when comparing multiple views of an interval.

Server and browser events share sequence numbers assigned at collection time. Network events retain CDP request IDs, and exceptions retain stack traces. Chronological proximity to a server line does not establish causation.

The timeline holds at most 5,000 events or 8 MiB. Individual records are capped. No log files are written by the runtime, and its evidence disappears on exit. Request headers and bodies are omitted; URL query values are redacted. Console output and server messages can still contain application secrets.

Only browser profile and session discovery data persist under `~/.d3k/<project>/`. Local control uses authenticated IPC, not an HTTP listener on the network. Automatic screenshots are off; use `browser screenshot <absolute-path>` when needed.

## Server and browser ownership

The runtime detects the project's package manager and `dev` script. Use `start --command '<dev command>'` for other projects or custom servers. Use `--headless` for CI and `--servers-only` when browser monitoring is intentionally unwanted.

Chrome's sandbox stays enabled in both headed and headless modes. If a constrained container cannot support Chrome sandboxing, explicitly set `D3K_CHROME_NO_SANDBOX=1` when starting the runtime. This disables browser isolation and emits a startup warning; use it only in an appropriately isolated environment. d3k does not retry without the sandbox automatically.

The agent and user share the same monitored browser. Do not launch a second server or substitute another browser profile during a session. Leave the runtime running when handing the browser to the user for testing.

Start local sessions with `d3k start`. Both timeout flags use milliseconds: `--startup-timeout` defaults to 120000 and `--browser-navigation-timeout` to 30000. Local startup also supports `--browser <path>`, `--profile-dir <dir>`, and `--debug`. Browser options cannot be combined with `--servers-only`.

`logs` shows recent retained events; `errors` filters errors and `--context` includes up to five preceding events per error. Both accept `--count 1..500` and `--json`; JSON includes cursor and evidence-gap metadata. Use cursor-based `events` for incremental reads. No command recovers evidence from a stopped session.

Upgrade explicitly with `d3k upgrade` (global Bun install), or update through your package manager. Startup never upgrades the package or installs skills.

## Remote project, local Chrome

Run this from any directory; the project repository never needs to exist on your laptop:

```bash
vercel login
d3k --project my-team/my-project --name my-dev
# The terminal enters the remote project directory. Then:
fx
```

This experimental command needs a recent Vercel CLI (tested with 59.26.0), Bun, Node.js 24+, local Chrome, and access to Vercel Sandbox. Run it from any directory: no local project checkout is needed. It uses your Vercel login to resolve the linked GitHub repository, project root, Development environment, and install/dev commands. It clones and installs the project remotely, uploads the installed d3k distribution, launches the dev server, opens a dedicated local Chrome, and enters the sandbox shell. `d3k sandbox --project my-project --scope my-team` is equivalent.

The shell starts in the Vercel project's root, ready for `fx`. d3k uses the image's fx binary or installs it from fx.sh when absent, then creates an expiring AI Gateway-only key for the selected team. Only fx receives that credential; it is stored outside the checkout with private permissions, revoked on exit, and expires after `--timeout` minutes if cleanup cannot run. Model usage is billed to that team's Gateway and follows its restrictions. The launcher selects this credential even if fx previously used another account. Use `--no-fx` to skip installation and Gateway setup and run your own agent instead. App environment variables are supplied to the dependency install and dev runtime; the interactive agent shell does not automatically inherit them.

The launcher supplies project-scoped CLI authentication to the interactive connection without forwarding that management token into the VM. Inside the remote project directory, use the existing runtime:

```bash
d3k status
d3k browser snapshot -i
d3k events --level error
```

The laptop keeps only d3k, browser profile, and session metadata; temporary pulled environment files are deleted. Other agents require their own authentication. Automatic creation currently clones **public GitHub repositories**. For private repositories, use `--attach my-dev` with an existing sandbox that already contains the checkout. d3k does not provision private-repository access or copy a GitHub token into the VM. Private package registry authentication also requires separate provisioning.

Use `--branch feature`, `--command 'bun run dev'`, or `--install-command 'bun install'` to override project defaults. Dev commands must honor `PORT`, which identifies the private upstream port. `--no-shell` retains the local browser companion without opening a shell; `--headless` runs local Chrome headlessly. New sandboxes default to a 30-minute compute timeout; use `--timeout <minutes>` to change it. Exiting stops the runtime and any sandbox created by this invocation, preserving its filesystem for `--attach <name>`. An attached sandbox stays running when the companion exits. Closing the dedicated Chrome also ends the session.

Chrome loads a stable local HTTPS origin: `https://<project>.d3k.localhost`. Use `--hostname songbook` for `https://songbook.d3k.localhost`. Canonical Portless must be ready on the laptop; no Portless installation is needed in the VM. A loopback streaming proxy forwards app traffic over verified HTTPS to the sandbox, preserving the local Host and forwarded origin, redirects, cookies, and WebSockets. The public sandbox app endpoint requires a fresh session token injected by the companion. Add the exact local callback URL to your auth provider's redirect allowlist (for example, `https://songbook.d3k.localhost/api/auth/callback`). A persistent outbound authenticated WSS connection carries CDP back to the VM; no externally reachable laptop listener, VPN, screen streaming, or file synchronization is needed. The VM exposes CDP discovery only on loopback. An in-VM streaming proxy preserves HTTP and application WebSockets and validates the exact app Origin before adapting Next.js HMR upgrades. Remote source edits can update local Chrome without a reload or project configuration change.

Rendering uses local CPU/GPU; app requests, HMR, and CDP still incur network latency. Choose a nearby sandbox region, batch browser operations, and avoid polling screenshots or large DOM snapshots. The bridge bounds buffers, uses heartbeats, and reconnects with backoff. Disconnects close outstanding CDP channels without replaying commands and record an evidence gap.

The sandbox agent controls this dedicated Chrome through CDP, so use it for development accounts. Its profile is separate from your everyday browser and retained per Vercel project under `~/.d3k/sandboxes/`. The companion listener binds only to loopback, and its sandbox upstream rejects requests without the session token. Application authentication still belongs to the app. Vercel management credentials stay on the laptop; Development app secrets run inside the sandbox.

## Launch a coding harness

Run a harness in your terminal after the app and monitored browser are ready:

```bash
# Local checkout
d3k start --harness codex

# Remote project; no local checkout required
d3k --project my-team/my-project --harness fx

# Existing sandbox containing the checkout
d3k --project my-team/my-project --attach my-dev --harness claude
```

`--harness` accepts `fx`, `codex`, or `claude`. It requires an interactive terminal and cannot be combined with `--no-shell` or `--servers-only`. Harnesses must be installed and authenticated, except for d3k's sandbox fx setup. Locally, harnesses use your local credentials; sandbox fx uses the temporary team AI Gateway key unless `--no-fx` is selected.

Codex and Claude receive a startup prompt to read the bundled d3k skill and reuse the running browser and timeline. fx receives temporary skill context through `--add-dir`; its interactive CLI has no startup prompt. Project instruction files are left intact. The flag accepts fixed harness names, not commands, paths, or extra arguments. Exiting the harness closes a session started by that invocation.

## Resume a sandbox

```bash
# List saved IDs, projects, sandbox names, branches, URLs, and last-used times
d3k --resume

# Restore the sandbox and its saved harness choice
d3k --resume <id>

# Choose another harness for this launch
d3k --resume <id> --harness codex

# Keep the browser companion running without an interactive shell
d3k --resume <id> --no-shell
```

On harness exit, shell exit, or Ctrl-C, d3k closes Chrome and prints `d3k --resume <id>` to stdout. Resume uses the existing checkout and browser profile, restores the hostname and launch settings, refreshes Development env and dependencies, restarts the dev runtime, and creates a fresh browser connection with new proxy and bridge tokens. It resumes the d3k sandbox session; it does not restore a harness's conversation.

Saved entries are local discovery metadata, without credentials or past terminal output. Remote availability is checked when resuming; a deleted sandbox cannot be recovered from the list. There is no automatic source-revision snapshot cache. Sandboxes created by d3k stop compute on exit while preserving their filesystem; externally attached sandboxes remain running.

Use `--command`, `--hostname`, `--timeout`, `--no-fx`, or `--headless` to override saved settings. A saved harness requires an interactive terminal, so use `--no-shell` only for sessions without a saved harness.

## Command surface and migration

The core commands are `start`, `stop`, `status`, `events`, `logs`, `errors`, `browser`, `portless status/setup`, `sandbox`, and explicit `upgrade`. Root options are for sandbox startup; local options belong after `start`. Unsupported options fail instead of being silently ignored.

The previous local runtime, terminal UI, tmux agent launcher/resume, built-in skill catalog/installer, `fix`, `crawl`, and `cdp-port` have been removed. Replace `d3k -t` with `d3k start`, file-backed `logs`/`errors` with live timeline reads, and `d3k agent-browser` with `d3k browser`. Use `start --command` instead of `--port`/`--script`; Portless assigns local ports. Harnesses can run independently or through `--harness`. Screenshot capture is explicit through `browser screenshot`.

The npm package ships JavaScript, requires Node.js 24+, and exposes the same runtime through all three executable names. Standalone binaries are not yet distributed. Existing files from older versions are left untouched but are no longer read.

The website is a public landing page and changelog. Hosted dev agents, skill runners, workflow execution, OAuth, teams, admin controls, report/blob storage, and CLI telemetry have been removed. Existing remote deployments and stored data are not deleted by a source change.

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
