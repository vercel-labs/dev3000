# Dev3000 + Next.js 15 Example

This is a minimal Next.js 15 application configured to work with dev3000's Docker setup.

## Features

- **Next.js 15** with Turbopack for fast builds
- **React 19** with modern hooks
- **MCP Server Integration** for dev3000 debugging tools
- **Docker & WSL Support** via external Chrome CDP
- **Hot Module Replacement** with polling for Docker compatibility

## Quick Start

### Option 1: Automated Docker Setup (Recommended)

From the repository root:

```bash
npm run dev3000:up
```

This will:
1. Launch Chrome with CDP on your host machine
2. Build and start the Docker container
3. Run dev3000 with this Next.js app

Access the app at:
- **Next.js**: http://localhost:3000
- **Dev3000 UI**: http://localhost:3684
- **Logs Viewer**: http://localhost:3684/logs

### Option 2: Standalone Development

Run this example without Docker:

```bash
cd example/nextjs15
pnpm install
pnpm dev
```

Then in another terminal, start dev3000:

```bash
dev3000 --port 3000
```

## Project Structure

```
example/nextjs15/
├── pages/
│   └── index.js          # Main page with counter example
├── package.json          # Next.js 15 + React 19 dependencies
├── next.config.js        # Turbopack + MCP configuration
├── .gitignore            # Standard Next.js ignores
└── README.md             # This file
```

## Configuration

### next.config.js

Key configurations for dev3000 integration:

```javascript
module.exports = {
  experimental: {
    mcpServer: true  // Enable MCP server integration
  },
  logging: {
    fetches: {
      fullUrl: true  // Log full URLs for better debugging
    }
  }
}
```

### package.json Scripts

- `pnpm dev` - Start development server with Turbopack
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm lint` - Run ESLint

## Development Workflow

### 1. Start the Environment

```bash
npm run dev3000:up
```

### 2. Make Changes

Edit `pages/index.js` or add new pages. Changes will hot-reload automatically.

### 3. Debug with dev3000

- View all logs at http://localhost:3684/logs
- Ask Claude to "fix my app" for AI-powered debugging
- Automatic screenshots on errors and navigation

### 4. Stop the Environment

```bash
npm run dev3000:down
```

## Using dev3000 Features

### AI-Powered Debugging

When you encounter errors, tell Claude:

```
fix my app
```

dev3000 will:
1. Analyze recent errors and logs
2. Show the exact interactions that triggered errors
3. Provide code fixes with file locations
4. Help you verify fixes by replaying interactions

### Browser Automation

Ask Claude to:
- "Take a screenshot of the current page"
- "Click the increment button"
- "Navigate to /about"

dev3000 executes these actions via Chrome DevTools Protocol.

### Log Analysis

All server and browser events are captured with timestamps:
- Server console output
- Browser console messages
- Network requests
- Automatic screenshots

Access logs at http://localhost:3684/logs

## Hot Reload in Docker

This example is configured for Docker/WSL environments:

```javascript
// Automatically set by docker-compose.yml:
process.env.CHOKIDAR_USEPOLLING = 'true'
process.env.WATCHPACK_POLLING = 'true'
```

These enable file watching via polling, which works across Docker volume mounts.

## Adding Pages

Create new pages in the `pages/` directory:

```javascript
// pages/about.js
export default function About() {
  return <h1>About Page</h1>
}
```

Access at http://localhost:3000/about

## API Routes

Create API routes in `pages/api/`:

```javascript
// pages/api/hello.js
export default function handler(req, res) {
  res.status(200).json({ message: 'Hello from dev3000!' })
}
```

Access at http://localhost:3000/api/hello

## Environment Variables

Create `.env.local` for local environment variables:

```env
NEXT_PUBLIC_API_URL=http://localhost:3000/api
NEXT_TELEMETRY_DISABLED=1
```

**Note**: In Docker, environment variables are set via `docker-compose.yml`.

## Troubleshooting

### Changes Not Hot-Reloading

Verify polling is enabled:
```bash
docker exec dev3000 env | grep POLLING
```

Should show:
```
CHOKIDAR_USEPOLLING=true
WATCHPACK_POLLING=true
```

### Port Already in Use

```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Or use a different port
dev3000 --port 5173
```

### Build Errors

Clear Next.js cache:
```bash
rm -rf .next
pnpm dev
```

## Next Steps

- Add more pages in `pages/`
- Create API routes in `pages/api/`
- Add styling with CSS modules or Tailwind
- Configure TypeScript (optional)
- Integrate with backend APIs

## Resources

- [dev3000 Documentation](../../README.md)
- [Docker Setup Guide](../../docker/README.md)
- [Next.js Documentation](https://nextjs.org/docs)
- [React 19 Documentation](https://react.dev)
