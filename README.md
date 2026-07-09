# d3k (dev3000)

d3k is an agent-first local web debugging runtime. It starts your dev server, opens a monitored browser with a project-stable Chrome profile, and gives your coding agent one timeline of server logs, browser errors, network activity, interactions, and screenshots.

Every app gets a stable Portless URL by default, so browser state and callbacks do not move when the underlying development port changes.

The primary interface is the d3k skill: tell your agent what you want, and let it own the runtime.

> "Let me test this project with d3k."
>
> "Debug the checkout flow with d3k."
>
> "Run this app with d3k and watch for errors while I reproduce the bug."

The TUI is still available for people who want a standalone terminal dashboard, but it is not required for the agent workflow.

## Install

Node.js 24 or newer is required.

Install the runtime globally:

```bash
bun install -g dev3000
```

npm also works:

```bash
npm install -g dev3000
```

Install the d3k skill for your coding agents:

```bash
bunx skills add vercel-labs/dev3000 --skill d3k --agent '*' -g -y
```

The skill teaches agents to start d3k non-interactively, retain the background process, reuse the managed browser, and inspect the unified evidence instead of launching a separate dev server or browser.

## The Agent Workflow

When you ask to use d3k, the agent should:

1. Run `d3k status --json` and reuse an active project session.
2. Start `d3k --no-agent --no-tui -t` in a retained background tool session when needed.
3. Wait for d3k to report a ready Portless URL and managed browser.
4. Either hand the headed browser to you or drive it with `d3k agent-browser`, depending on your request.
5. Read `d3k errors --context` and the unified logs after reproduction.
6. Keep the same runtime and project-stable Chrome profile alive across edits and retests.

That gives the user one stable URL, one browser, one evidence stream, and one dev server.

### "Let me test" vs. "Test this"

"Let me test with d3k" means the agent prepares the headed monitored browser and hands control to you. It should wait while you reproduce the issue, then inspect what d3k captured.

"Test/debug this with d3k" means the agent can drive the managed browser and investigate autonomously.

## Agent Commands

```bash
# Is this project's runtime ready?
d3k status --json

# Start the runtime manually in agent-safe mode
d3k --no-agent --no-tui -t

# Inspect unified evidence
d3k errors --context
d3k logs -n 200
d3k logs --type browser
d3k logs --type server

# Drive the exact browser d3k is monitoring
d3k agent-browser snapshot -i
d3k agent-browser click @e2
d3k agent-browser fill @e3 "text"
d3k agent-browser --require-d3k-browser open http://localhost:3000
```

Do not run `npm run dev` or `bun run dev` alongside d3k. d3k is the dev-server owner for the session.

Portless is automatic. Use `--no-portless` or `PORTLESS=0` only when direct localhost routing is specifically required. If Portless cannot initialize, d3k falls back to localhost instead of blocking startup.

## Why the Managed Browser Matters

Each project gets a persistent Chrome profile under `~/.d3k/<project>/chrome-profile/`. Login state, cookies, and local storage survive across debugging sessions.

d3k also connects browser activity to server output, so an agent can see the interaction that preceded an error instead of reasoning from disconnected terminal and browser snapshots.

For OAuth and other auth-sensitive flows, let d3k launch Chrome. A separate Playwright, browser MCP, raw Chrome, or custom `agent-browser --profile` session is a different browser identity and can break sign-in flows.

## What d3k Captures

- Development-server output
- Browser console messages and exceptions
- Network requests and responses
- User interactions
- Navigation and error screenshots
- Chrome DevTools Protocol events
- A session manifest that agents can discover with `d3k status --json`

Artifacts are stored per project:

| Artifact | Location |
| --- | --- |
| Active session | `~/.d3k/<project>/session.json` |
| Consolidated log | `~/.d3k/<project>/d3k.log` or `logs/` |
| Screenshots | `~/.d3k/<project>/screenshots/` |
| Chrome profile | `~/.d3k/<project>/chrome-profile/` |
| Crash log | `~/.d3k/crash.log` |

## Standalone TUI

Run `d3k` directly when you want the interactive terminal experience:

```bash
d3k
```

You can also launch an agent beside the TUI in tmux:

```bash
d3k --with-agent claude
d3k --with-agent codex
d3k --with-agent opencode
```

The split-screen workflow requires tmux. The agent-first background workflow does not.

## Runtime Options

```bash
d3k --help
```

| Option | Purpose |
| --- | --- |
| `-p, --port <port>` | Override the detected dev-server port |
| `-s, --script <script>` | Override the detected package script |
| `-c, --command <command>` | Run a custom dev-server command |
| `--app-url <url>` | Open a specific URL in the managed browser |
| `--profile-dir <dir>` | Override the project Chrome profile |
| `--no-portless` | Disable the default stable Portless URL |
| `--headless` | Run Chrome headlessly for CI |
| `--servers-only` | Intentionally disable browser monitoring |
| `--no-tui` | Disable the interactive dashboard |
| `--no-agent` | Skip the standalone agent-selection prompt |
| `-t, --tail` | Stream the consolidated log |
| `--debug` | Print verbose runtime diagnostics |

Prefer auto-detection. Use overrides only when the project has an unusual dev command, port, or target URL.

## Diagnostic Commands

```bash
d3k errors
d3k errors --context
d3k errors --all

d3k logs
d3k logs --type browser
d3k logs --type server
d3k logs --json

d3k fix
d3k fix --focus build

d3k crawl
d3k crawl --depth all
```

## Supported Projects

d3k detects common web projects, including:

- Next.js, Vite, React, Vue, Svelte, and Astro
- Django, Flask, and FastAPI
- Rails
- Custom servers supplied through `--command`

## Development

Use d3k itself as the local runtime for this repository:

```bash
d3k --no-agent --no-tui -t
```

After code changes:

```bash
bun run lint
bun run typecheck
```

For CLI or TUI changes under `src/`:

```bash
bun run canary
```

## License

MIT
