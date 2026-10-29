---
name: d3k
description: Run and debug a local web app with a managed browser and a shared server/browser evidence timeline. Use when asked to develop, test, or reproduce a browser issue with d3k.
---

# d3k

Own the project's dev server and monitored browser through a small background runtime. No global d3k installation is needed. Evidence stays in bounded memory; browser authentication stays in the project Chrome profile.

Use `node <skill-directory>/scripts/runtime.mjs` as `runtime` below, from the **target project root**. In a development checkout the helper runs the source with Bun; installed skills use the JavaScript package through `pnpm dlx` (Node.js 24+ and pnpm required). Package acquisition runs in an isolated temporary directory so the target app’s pnpm workspace settings do not affect it; runtime commands still run against the target project. To try unreleased source from another project, set `D3K_RUNTIME_ROOT` to the dev3000 checkout. Do not use a previously published package to test unreleased changes.

## Prepare

1. Run `runtime portless status`. Canonical HTTPS must be ready (`canonical: true`, `serviceInstalled: true`, `setupRequired: false`) before starting the app or browser. If needed run `runtime portless setup`, wait for the one-time administrator authorization, then check again. Stop if setup is unavailable; never silently substitute direct localhost.
2. Run `runtime status`. Reuse a ready runtime for this project. If it is starting, wait for readiness. Do not start another dev server.
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

## Vercel Sandbox with local Chrome

For a remote project with no local checkout, run `runtime sandbox --project <name-or-id> --scope <team> --name <sandbox-name> --no-shell` on the laptop in a retained background session. The launcher requires Vercel CLI login, Bun, Node.js 24+, macOS, and Chrome for Testing (`bunx agent-browser install`). It creates a sandbox from the project's linked public GitHub repository, pulls Development env through Vercel CLI, installs dependencies, and starts the remote skill runtime. For a private repository, use `--attach <name>` with an existing sandbox that already contains the checkout. Private-repository access must be configured separately. Do not supply GitHub or Vercel management tokens to the app environment.

The app uses `https://<project>.d3k.localhost`; `--hostname songbook` selects `https://songbook.d3k.localhost`. Canonical Portless is required on the laptop before launch, with no Portless inside the VM. A loopback streaming proxy forwards verified HTTPS app traffic and a session token to the sandbox. Add the exact local auth callback URL to the provider allowlist. The laptop companion opens a dedicated local Chrome and maintains an authenticated outbound WSS bridge; project source and dev compute stay remote. Dev commands must honor `PORT`. Keep the companion alive throughout debugging.

Run status, browser, events, and stop commands **inside the sandbox's project directory**, using `/tmp/d3k-tools/node_modules/.bin/d3k-runtime`. For example, use `vercel sandbox exec <name> --project <project-id> --scope <team> --workdir <remote-project-root> -- /tmp/d3k-tools/node_modules/.bin/d3k-runtime browser snapshot -i`. Supply a fresh project OIDC token obtained from `vercel project token <project-id> --scope <team> --format json` as the CLI process's `VERCEL_OIDC_TOKEN` environment variable if needed; capture it without printing it or putting it in command arguments. The interactive launcher handles this authentication automatically. Read the remote `status` before driving Chrome and reuse that runtime; do not start another runtime or browser. An interactive `d3k --project team/project` (or `d3k sandbox`) enters the remote project directory and adds tools to PATH. Type `fx` there after authenticating the harness in the sandbox; d3k installs fx if absent but does not provision Gateway keys or forward laptop credentials. `--no-fx` skips installation. Project processes share the harness identity, so manually configured credentials are accessible to project code. Without a TTY, use `vercel sandbox exec` or `vercel sandbox connect` separately. All remote harnesses need their own authentication. The interactive shell does not inherit app env automatically.

App traffic streams through the local proxy to the sandbox, preserving the browser origin, redirects, cookies, and WebSockets. Batch browser operations to reduce CDP round trips, select a nearby sandbox region, and avoid continuous screenshots. HMR works through the in-VM proxy. A bridge disconnect records an evidence gap and closes pending channels without replaying commands; reread status and reproduce after reconnecting before claiming complete evidence.

Stopping the local launcher stops its runtime and a sandbox it created while preserving the sandbox filesystem. `--attach` leaves the existing VM running. The sandbox agent can control the dedicated Chrome profile, and the public sandbox app endpoint requires the companion session token; application authentication remains the app's responsibility. Keep agent credentials separate from infrastructure credentials; never describe remote browser control as adding no security risk.

## CLI aliases and evidence views

`d3k`, `dev3000`, and `d3k-runtime` use the same implementation. Local startup is `start`; root options are for sandbox mode. Timeout flags use milliseconds. `logs --count <1..500> --type server|browser|runtime|all` and `errors --context` read recent events from the same live timeline; use `--json` to retain evidence-gap metadata. Prefer cursor-based `events` for reproductions. The runtime does not install agent packages, write log files, or automatically upgrade. Use `browser` rather than the removed `agent-browser` subcommand.

Sandbox resume: `d3k --resume` lists locally saved session IDs, projects, sandbox names, branches, URLs, and last-used times. `d3k --resume <id>` restores that sandbox checkout and hostname, refreshes Development env and dependencies, restarts the dev runtime, and pairs the retained browser profile using fresh bridge/proxy tokens. No repository checkout is needed on the laptop. Ctrl-C closes the browser and prints the resume command to stdout. Saved entries contain discovery metadata, not credentials or past terminal output; remote availability is checked on resume. Optional `--command`, `--hostname`, `--timeout`, `--no-shell`, `--no-fx`, and `--headless` override launch settings. Sandboxes originally created by d3k stop compute again on resumed exit; externally attached sandboxes remain running.

Use `d3k start --harness codex` locally or `d3k --project my-team/my-project --harness fx` remotely to launch a coding harness after readiness. The supported choices are `fx`, `codex`, and `claude`; commands, paths, and extra arguments are rejected. An interactive terminal is required, and exiting the harness closes a session started by that invocation. Harnesses must already be installed and authenticated, except for existing sandbox fx setup. Codex/Claude receive a prompt to read the bundled d3k skill and reuse the runtime; fx receives a temporary skill context through `--add-dir` (its interactive CLI has no startup prompt). No project instruction files are overwritten. Local harnesses use local credentials; sandbox fx can use the temporary team Gateway key. `--resume <id>` remembers the harness choice.

Sandbox Chrome and its children run under macOS filesystem confinement. Do not bypass it or substitute an unrestricted browser. The outer policy replaces Chrome's inner sandbox because macOS cannot nest them. Only Chrome, required system files, and the dedicated profile and temporary files are readable; unrelated laptop files are denied. The profile uses a local password store rather than the laptop keychain. Browser sessions remain accessible to sandbox automation. Other platforms fail closed until equivalent isolation is available.
