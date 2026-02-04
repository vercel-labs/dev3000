# d3k (dev3000)

![d3k terminal interface](./www/public/hero-terminal.png)

A debugging assistant that captures everything happening in your web app during development - server logs, browser events, network requests, and automatic screenshots - organized in a timeline that AI can understand.

## Quick Start

```bash
bun install -g dev3000
d3k
```

You can also install with npm or pnpm if you prefer — bun is recommended.

Select an AI agent (Claude, Codex, etc.) and start debugging. Tell your agent: "fix my app"

## Requirements

- Node.js >= v22.12.0
- tmux (for split-screen mode with AI agents)

## What It Does

d3k runs your development server and monitors it in a browser, capturing:

- Server logs and console output
- Browser console messages and errors
- Network requests and responses
- Automatic screenshots (navigation, errors, interactions)
- User interactions (clicks, form submissions)

Everything is saved to timestamped logs that AI assistants can read to understand what went wrong and suggest fixes.

## CLI Commands

### Main Command

```bash
d3k                    # Start d3k with agent selection prompt
d3k --with-agent claude  # Start with Claude in split-screen mode
d3k --no-agent         # Start d3k standalone (no agent)
```

### Diagnostic Commands

```bash
d3k errors             # Show recent errors (browser + server combined!)
d3k errors -n 20       # Show last 20 errors
d3k errors --context   # Show interactions before each error (for replay)
d3k errors --all       # Show all errors from the session

d3k logs               # Show recent logs (browser + server combined)
d3k logs --type browser  # Show only browser logs
d3k logs --type server   # Show only server logs
d3k logs -n 100        # Show last 100 lines

d3k fix                # Deep analysis of application errors
d3k fix --focus build  # Focus on build/compilation errors
d3k fix --time 30      # Analyze last 30 minutes (default: 10)

d3k crawl              # Discover URLs by crawling the app
d3k crawl --depth all  # Exhaustive crawl (default: 1 level)

d3k find-component "nav.header"  # Find React component source
d3k find-component "[data-testid='button']"

d3k restart            # Restart the development server (rarely needed)
```

### Other Commands

```bash
d3k skill [name]       # Get skill content or list available skills
d3k upgrade            # Upgrade d3k to the latest version
d3k agent-browser      # Run the bundled agent-browser CLI
d3k cloud              # Cloud-based tools using Vercel Sandbox
```

## Options

```bash
d3k --help             # Show all options
```

| Option | Description |
|--------|-------------|
| `-p, --port <port>` | Development server port (auto-detected) |
| `-s, --script <script>` | Script to run (e.g. dev, main.py) |
| `-c, --command <command>` | Custom command (overrides auto-detection) |
| `--browser <path>` | Path to browser executable (Chrome, Arc, etc.) |
| `--profile-dir <dir>` | Chrome profile directory |
| `--servers-only` | Run servers only, skip browser launch |
| `--headless` | Run browser in headless mode (for CI) |
| `--debug` | Enable debug logging (disables TUI) |
| `-t, --tail` | Output logfile to terminal (like tail -f) |
| `--no-tui` | Disable TUI, use standard terminal output |
| `--with-agent <cmd>` | Run agent in split-screen mode (requires tmux) |
| `--no-agent` | Skip agent selection, run standalone |
| `--plugin-react-scan` | Enable react-scan performance monitoring |
| `--date-time <format>` | Timestamp format: 'local' or 'utc' |

## How It Works

1. **Start d3k** - It detects your project type and starts the dev server
2. **Browser monitoring** - A browser opens and monitors your app via Chrome DevTools Protocol
3. **Capture everything** - Logs, errors, network requests, screenshots are saved
4. **AI reads logs** - Your AI agent can read `~/.d3k/{project}/d3k.log` to understand issues
5. **Fix with context** - The AI has full context to suggest accurate fixes

## File Locations

| What | Where |
|------|-------|
| Logs | `~/.d3k/{project}/d3k.log` |
| Screenshots | `~/.d3k/{project}/screenshots/` |
| Chrome profile | `~/.d3k/{project}/chrome-profile/` |
| Session info | `~/.d3k/{project}/session.json` |
| Crash logs | `~/.d3k/crash.log` |

## Browser Options

### Chrome (Default)

d3k launches Chrome by default. Each project gets a dedicated Chrome profile that preserves login state, cookies, and local storage.

### Arc Browser

```bash
d3k --browser '/Applications/Arc.app/Contents/MacOS/Arc'
```

### Other Chromium Browsers

```bash
# Brave
d3k --browser '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'

# Edge
d3k --browser '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
```

### Servers Only Mode

Skip browser monitoring entirely:

```bash
d3k --servers-only
```

### Headless Mode

For CI/CD environments:

```bash
d3k --headless
```

## Split-Screen Mode (tmux)

d3k can run alongside your AI agent in a split-screen terminal using tmux:

```bash
d3k --with-agent claude    # Claude Code
d3k --with-agent codex     # OpenAI Codex
d3k --with-agent opencode  # OpenCode
```

Requirements:
- tmux installed (`brew install tmux` on macOS)

Controls:
- `Ctrl+B Left/Right` - Switch focus between panes
- `Ctrl+C` in either pane - Exit both

## Supported Frameworks

d3k works with any web framework:

- **JavaScript/TypeScript**: Next.js, Vite, Create React App, Vue, Svelte, Astro
- **Python**: Django, Flask, FastAPI
- **Ruby**: Rails
- **Any other** web framework with a dev server

## FAQ

### Does this work with Cursor, Windsurf, etc.?

Yes! d3k works with any AI assistant that can read files. Point your AI to the log file at `~/.d3k/{project}/d3k.log`.

### How do I stop d3k?

`Ctrl+C` stops both d3k and your development server.

### Where are screenshots saved?

Screenshots are saved to `~/.d3k/{project}/screenshots/` with timestamps.

### What if d3k crashes?

Check `~/.d3k/crash.log` for details. Run with `--debug` for more verbose output.

## Development

```bash
# Install dependencies
bun install

# Run locally
bun run dev

# Build
bun run build

# Test
bun run test

# Lint
bun run lint
```

## Contributing

We welcome contributions! Please see our [contributing guidelines](./CONTRIBUTING.md).

## License

MIT
