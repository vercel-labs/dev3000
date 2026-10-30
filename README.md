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

The timeline holds at most 5,000 events or 8 MiB. Individual records are capped. No log files are written by the runtime, and its evidence disappears on exit.

Network evidence includes redacted request/response headers (including wire-header events), protocol/cache metadata, encoded transfer size, raw CDP response timing, and DNS/connect/TLS/send/TTFB/download/total durations in milliseconds when available.

Request and response body previews capture app-origin Fetch/XHR JSON and URL-encoded forms, redact common credential fields recursively, and retain up to 8 KiB per preview. Bodies over 64 KiB, unsupported formats (including binary and streaming responses), and cross-origin bodies are omitted; completed API requests report an omission reason when capture is unavailable. Response bodies arrive as separate `response-body` events after completion, so continue reading the timeline after the request finishes.

URL query values, authorization/cookie headers, and common credential fields are redacted; this is best-effort redaction, and application payloads, console output, and server messages can still contain sensitive data.

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

This experimental command needs a recent Vercel CLI (tested with 59.26.0), Bun, Node.js 24+, macOS, and access to Vercel Sandbox. d3k downloads Chrome for Testing automatically on first use and reuses it afterward. Run it from any directory: no local project checkout is needed. It uses your Vercel login to resolve the linked GitHub repository, project root, Development environment, and install/dev commands. It clones and installs the project remotely, uploads the installed d3k distribution, launches the dev server, opens a dedicated local Chrome, and enters the sandbox shell. `d3k sandbox --project my-project --scope my-team` is equivalent.

The shell starts in the Vercel project's root. d3k uses the image's fx binary or installs it from fx.sh when absent. fx connects automatically to the selected project’s team AI Gateway using a project-scoped session key. The key expires automatically after `--timeout` minutes (default: 60) and has a $5 non-renewing spending limit including BYOK usage. d3k prints the expiration time when the session closes. Resume creates a fresh key. Use `--gateway-budget 20` to change the session limit or `--no-gateway` for manual authentication. Automatic setup requires permission to create team Gateway API keys and does not bypass team model or provider restrictions. Project processes and harnesses share the sandbox identity, so use projects you trust with that limited Gateway access. d3k does not forward laptop harness credentials or Vercel management tokens. Use `--no-fx` to skip installation. App environment variables are supplied to dependency installation and the dev runtime; the interactive harness shell does not automatically inherit them.

Sandbox mode currently requires macOS. Chrome runs under an OS filesystem policy that permits its application bundle, system libraries, and dedicated d3k profile and temporary files. Other laptop files are denied, including CDP navigation and uploads. Host clipboard access is blocked at the OS pasteboard service. Chrome's inner sandbox cannot nest inside this macOS policy; the outer policy applies to the browser and all its children. Cookies use the dedicated profile’s local storage instead of the laptop keychain. A sandbox session can read and modify its own browser profile and authenticated web sessions. Use sandbox mode with projects you trust with that session's browser access. Other operating systems fail closed until equivalent confinement is available.

Remote harness context includes the laptop browser's existing CDP bridge, project directory, and exact `d3k-runtime browser` commands. Sandbox fx automatically loads the connected-session skill from a temporary block in its own `~/.fx/AGENTS.md` at startup, including when launched manually from the shell. Existing instructions are preserved, and the block is removed on exit; repository instruction files are untouched.

The launcher supplies project-scoped CLI authentication to the interactive connection without forwarding that management token into the VM. Inside the remote project directory, use the existing runtime:

```bash
d3k status
d3k browser snapshot -i
d3k events --level error
```

Development environment values pass through launcher memory into the sandbox; d3k does not save a local env file or project checkout. The laptop keeps d3k, its browser profile, and session metadata. Other agents require their own authentication. Automatic creation currently clones **public GitHub repositories**. For private repositories, use `--attach my-dev` with an existing sandbox that already contains the checkout. d3k does not provision private-repository access or copy a GitHub token into the VM. Private package registry authentication also requires separate provisioning.

Use `--branch feature`, `--command 'bun run dev'`, or `--install-command 'bun install'` to override project defaults. Dev commands must honor `PORT`, which identifies the private upstream port. `--no-shell` retains the local browser companion without opening a shell; `--headless` runs local Chrome headlessly. Sandbox compute and Gateway keys both default to a 60-minute lifetime; `--timeout <minutes>` changes both equally. Exiting stops the runtime and any sandbox created by this invocation, preserving its filesystem for `--attach <name>`. An attached sandbox stays running when the companion exits. Closing the dedicated Chrome also ends the session.

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

`--harness` accepts `fx`, `codex`, or `claude`. With `--project`, the harness runs **locally by default**, using a control directory with connection instructions. Local fx keeps the same workspace identity across d3k resumes; other local harnesses use a temporary directory. Project files, dependency installs, tests, Git branches and commits stay in the sandbox. Image pasting uses your local harness. Browser tools connect directly to local Chrome; file and runtime tools execute remotely. The local harness must already be installed. fx receives automatic team Gateway credentials locally; other harnesses use their own local authentication. It requires an interactive terminal and cannot be combined with `--no-shell` or `--servers-only`.

Use `--harness-location sandbox` to run the harness inside the sandbox instead:

```bash
d3k --project my-team/my-project --harness fx --harness-location sandbox
```

That mode retains fx installation and remote Gateway setup; other harnesses need remote installation and authentication. Without `--harness`, the command still opens a remote shell. Resume remembers both the harness and its location; `--harness-location` overrides the saved choice.

Local harnesses receive sandbox file, shell, runtime, browser, and repository-scoped GitHub tools. Codex and Claude load the tools through per-launch MCP configuration. fx can use the generated remote-command helper without MCP approval or discovery. Both paths use an authenticated loopback broker; Vercel credentials remain in the launcher. The GitHub tool uses local `gh` authentication against the linked repository to publish Git objects, branch refs and PRs without forwarding a GitHub credential. It rejects force pushes. Local harness conversations and tool results can contain code the agent reads, even though d3k creates no local checkout.

All local harnesses connected to a sandbox receive workspace instructions in the control directory; Codex and Claude also receive them directly at launch. For a harness running inside the sandbox, Codex and Claude receive the connected-session skill in their startup prompt, and fx automatically loads it through its temporary managed instructions. Project instruction files are left intact. The flag accepts fixed harness names, not commands, paths, or extra arguments. Exiting the harness closes a session started by that invocation.

## ChatGPT and Claude Desktop

Desktop clients can own a sandbox session directly through a local MCP server. No terminal harness or Gateway key is needed; the desktop client supplies the model. The project checkout, app environment, dev server, tests and Git edits stay remote, with Chrome running locally.

After installing the CLI and signing in to Vercel, prepare canonical HTTPS and print the desktop configuration:

```bash
d3k portless setup
d3k mcp --print-config
```

The generated `mcpServers.d3k` entry contains an absolute Node executable, the installed CLI path, and your shell's PATH so GUI clients can find Vercel CLI, Bun, and `gh`. It contains no credentials. Regenerate it after replacing the installation or Node version. This server uses **local stdio**, started by the desktop client with `d3k mcp`.

- **ChatGPT Desktop:** Settings → MCP servers → Add server → STDIO. Copy the generated command, arguments and PATH environment value, save, then restart the server. Use a local thread with access to that server.
- **Claude Desktop:** merge the generated `d3k` entry into `mcpServers` in `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, preserving other servers, then restart Claude. This uses Claude Desktop's local MCP support, rather than a remote connector or Cowork.

Then ask:

> Use d3k to open my-team/my-project in a sandbox. Keep code and app env remote, and use the connected local Chrome to test my changes.

The server preloads remote-workspace instructions. `sandbox_start` returns immediately; `sandbox_status` reports startup progress and readiness. Once ready, `sandbox_exec`, `sandbox_read_file`, `sandbox_write_file`, `sandbox_runtime`, `sandbox_browser`, and `sandbox_github` provide the same workspace tools as local terminal harnesses. `sandbox_sessions` lists saved resume IDs; call `sandbox_start` with `resume` to reconnect. `sandbox_recover` restores a stopped dev runtime in the same session without cloning, reinstalling, or restarting the assistant or local Chrome. Call with `action: "start"`, then poll `action: "status"` until recovered or failed; reread runtime status afterward because restarted runtimes lose old in-memory evidence. Recovery does not replay agent commands, renew Gateway credentials, or extend compute lifetime. It is also available through local terminal harness workspace tools. `sandbox_stop` closes Chrome and d3k-owned compute while preserving remote files. Wait for `stopped` before starting another session.

For testing on a phone, ask the connected assistant to start with `browser: "link"`. Once ready, `sandbox_status` includes `preview.url` and `preview.expiresAt`. Open that HTTPS link in the phone's browser; the app renders on the phone while companion Chrome runs headlessly for agent testing. HTTP and HMR use the sandbox's HTTPS origin rather than `.localhost`. The link grants app access for this session, exchanges its secret fragment for a Secure, HttpOnly cookie, and expires when the session ends or its deadline passes. Keep it out of PRs and public logs. Resume with `browser: "link"` to create a fresh link. App authentication remains separate; auth providers may require the preview origin's exact callback URL in their redirect allowlist.

This still requires the running macOS companion and a client connected to its local MCP server. It does not make the MCP server accessible to ChatGPT on a phone. Stdio has no phone User-Agent; the assistant selects link mode from the user's request or explicit client context. The agent controls companion Chrome, not the phone's Safari or Chrome.

One sandbox is active per MCP server. Disconnecting or restarting the server also closes its session; resume it afterward. Sessions owned by another running companion are not taken over. macOS, local Vercel login, Bun, Node.js 24+, Sandbox access and canonical Portless remain required. GitHub publishing uses local `gh` authentication scoped to the linked repository. Client tool approvals and workspace policies still apply. Desktop conversation history may retain code returned by tools, even though d3k creates no local checkout or env file.

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

On harness exit, shell exit, or Ctrl-C, d3k closes Chrome and prints `d3k --resume <id>` to stdout. Resume uses the existing checkout and browser profile, restores the hostname and launch settings, refreshes Development env and dependencies, restarts the dev runtime, and creates a fresh browser connection with new proxy and bridge tokens. When the saved harness is fx, resume also passes `fx -c` to continue its remembered conversation. Local fx uses a workspace directory recorded per d3k session, so separate sandboxes keep separate conversation histories. d3k refreshes connection instructions and removes the broker credential on exit; fx owns the saved conversation. Other harness conversations are not automatically resumed. A plain remote shell still requires typing `fx -c` yourself.

Temporary runtime-monitor connection failures retry without closing your shell. If the remote dev runtime exits while your harness is running, d3k reports it and keeps the shell open so you can finish or save your work. Exit the shell and resume to restore the dev server and browser. The sandbox's configured timeout still applies.

The interactive terminal uses WebSocket keepalives. If its connection drops without a confirmed remote process exit, d3k keeps the sandbox and browser running and prints a command to reconnect from another terminal. It does not automatically relaunch the harness or replay agent actions. Press Ctrl-C in the original terminal to close the session when finished.

Saved entries are local discovery metadata, without credentials or past terminal output. Remote availability is checked when resuming; a deleted sandbox cannot be recovered from the list. There is no automatic source-revision snapshot cache. Sandboxes created by d3k stop compute on exit while preserving their filesystem; externally attached sandboxes remain running.

Use `--command`, `--hostname`, `--timeout`, `--harness-location`, `--no-fx`, `--no-gateway`, `--gateway-budget`, or `--headless` to override saved settings. A saved harness requires an interactive terminal, so use `--no-shell` only for sessions without a saved harness.

## Command surface and migration

Capture page-load metrics in a new tab of the managed browser:

```bash
d3k browser metrics https://example.com/ --new-tab
```

Returns JSON with Web Vitals, navigation timing (DNS, connect, TLS, TTFB, download, DOMContentLoaded and load), long tasks, and resource counts, sizes and slowest entries. Observers start before navigation. With no URL, `d3k browser metrics` inspects the current page without reloading; CLS and long tasks are unavailable. For MCP use `sandbox_browser` with `args: ["metrics", "https://example.com/", "--new-tab"]`. Harness startup instructions include this command.

These are explicit snapshots with provisional vitals, using the existing browser cache and throttling. They are not Lighthouse scores or field data. INP needs user interaction; unavailable metrics are `null`. Cross-origin timing restrictions and buffer limits can hide data; zero transfer bytes alone do not prove a cache hit. URL query values are redacted. Passive network events remain a separate source of request-level evidence.

The core commands are `start`, `stop`, `status`, `events`, `logs`, `errors`, `browser`, `portless status/setup`, `sandbox`, `mcp`, and explicit `upgrade`. Root options are for sandbox startup; local options belong after `start`. Unsupported options fail instead of being silently ignored.

The previous local runtime, terminal UI, tmux agent launcher/resume, built-in skill catalog/installer, `fix`, `crawl`, and `cdp-port` have been removed. Replace `d3k -t` with `d3k start`, file-backed `logs`/`errors` with live timeline reads, and `d3k agent-browser` with `d3k browser`. Use `start --command` instead of `--port`/`--script`; Portless assigns local ports. Harnesses can run independently or through `--harness`. Screenshot capture is explicit through `browser screenshot`.

The npm package ships JavaScript, requires Node.js 24+, and exposes the same runtime through all three executable names. Standalone binaries are not yet distributed. Existing files from older versions are left untouched but are no longer read.

The website contains the public landing page and changelog, plus an owner-only hosted MCP pilot. The previous hosted agent runners, workflow execution, teams, admin controls, report/blob storage, and CLI telemetry remain removed. Existing remote deployments and stored data are not deleted by a source change.

## Hosted MCP pilot

The hosted `/mcp` endpoint can run without your laptop. It starts the linked project, its Development environment, and automated Chrome inside Vercel Sandbox. A private HTTPS preview link opens the app in the user's phone or desktop browser; the agent controls a separate sandbox Chrome. The desktop `d3k mcp` companion described above remains available independently.

Access uses Sign in with Vercel through an OAuth 2.1 broker with PKCE and explicit client consent. This pilot admits one configured immutable Vercel user ID and an explicit project allowlist. The Vercel sign-in app currently supplies identity only; a dedicated project-scoped Vercel management token stays in the hosted service. Neither that token nor the OAuth client secret enters a project sandbox. Preview links grant app access only and expire with their session.

Hosted tools require an explicit session ID, so separate chats can use separate workspaces. The pilot permits two active workspaces with a one-hour deadline. `sandbox_stop` preserves files; `sandbox_start` with `resume` restores them with a new preview link. `sandbox_recover` restarts a stopped dev runtime without cloning or reinstalling. Initial support requires a linked public GitHub repository. Hosted GitHub publishing is not configured yet; the CLI companion's local `gh` publishing does not apply to the hosted service.

Deployment and credential setup are documented in [www/HOSTED-MCP.md](www/HOSTED-MCP.md). This is an opt-in pilot, not a generally available mobile connector.

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
