# Frontend Example - Next.js 16 with dev3000

This is a sample Next.js 16 application demonstrating dev3000 integration for AI-powered development monitoring and debugging.

## Two Use Cases

dev3000 is designed for two different workflows:

### Use Case 1: Try dev3000 (This Repository)

Test dev3000 with this example application:

```
/dev3000/                       # This repository
├── frontend/                   # This example (copied from example/)
├── docker/
│   └── docker-compose.yml
├── Makefile
└── example/                    # Example applications
```

**Quick Start:**
```bash
# From dev3000 repository root
make dev-up
```

### Use Case 2: Integrate into Your Project (Recommended)

Use dev3000 as a submodule in your own project:

```
/my-project/                    # Your project root
├── frontend/                   # Your Next.js application
│   ├── .dev3000/              # dev3000 as submodule
│   ├── app/                    # Your Next.js code
│   └── package.json
├── docker/                     # Your docker config (copied from reference)
│   └── docker-compose.yml
└── Makefile                    # Your Makefile (copied from reference)
```

**Quick Start:**
```bash
# 1. Clone dev3000 into your frontend directory
cd /path/to/your-project/frontend
git clone https://github.com/automationjp/dev3000 .dev3000

# 2. Copy reference files to your project root
cd ..
mkdir -p docker
cp frontend/.dev3000/frontend/docker-reference/docker-compose.yml docker/
cp frontend/.dev3000/frontend/docker-reference/Makefile ./

# 3. Start dev3000
make dev-up
```

📖 **Full integration guide**: See [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md)

---

## Setup Instructions (Use Case 1: This Repository)

Access your application:
- **Next.js App**: http://localhost:3000
- **dev3000 Logs**: http://localhost:3684/logs
- **MCP Server**: http://localhost:3684

## What This Example Demonstrates

This sample application showcases Next.js 16 features that work seamlessly with dev3000 monitoring:

### Core Features
- **App Router** - Next.js 16's file-based routing with Server and Client Components
- **TypeScript** - Full type safety across the application
- **Tailwind CSS** - Utility-first CSS framework for modern styling
- **React 19** - Latest React with new hooks and features

### Demo Pages
1. **Counter Demo** (`/demos/counter`) - Client-side state management
2. **Server Actions** (`/demos/server-actions`) - Form handling and mutations
3. **Context7** (`/demos/context7`) - Library documentation search example
4. **Next.js MCP** (`/demos/nextjs-mcp`) - Builtin MCP features in Next.js 16
5. **Browser Automation** (`/demos/browser-automation`) - CDP integration demo
6. **fix_my_app** (`/demos/fix-my-app`) - AI-powered debugging demonstration
7. **Parallel Routes** (`/demos/parallel-routes`) - Advanced routing patterns

## Development Workflow

### 1. Start Monitoring
```bash
# From project root
make dev-up
```

### 2. Develop Your App
- Edit files in `app/`
- Changes hot-reload via Turbopack
- All activity logged by dev3000

### 3. Debug with AI
```bash
# In Claude Code
"fix my app"
```

### 4. View Logs
- Open http://localhost:3684/logs
- See timeline of all events
- Screenshots linked to errors

### 5. Stop Monitoring
```bash
make dev-down
```

## How dev3000 Helps

When running with dev3000:

1. **Automatic Monitoring**
   - Server logs captured
   - Browser console recorded
   - Network requests tracked
   - Screenshots on errors

2. **AI-Powered Debugging**
   - "fix my app" for analysis
   - Prioritized error reports
   - Exact fix suggestions
   - Interaction replay

3. **MCP Integration**
   - Next.js builtin MCP at `/_next/mcp`
   - dev3000 MCP at http://localhost:3684
   - Context7 for docs
   - CDP browser access

## Configuration

### next.config.js

```javascript
module.exports = {
  experimental: {
    turbo: { /* Turbopack config */ },
    serverActions: { bodySizeLimit: '2mb' },
  },
  logging: {
    fetches: { fullUrl: true }
  },
}
```

### package.json

**Key dependencies:**
- `next: ^16.0.0` - Next.js 16 with builtin MCP
- `react: ^19.0.0` - React 19 with new hooks
- `react-dom: ^19.0.0` - React DOM 19

**Dev dependencies:**
- `@biomejs/biome: ^1.9.4` - Ultra-fast Rust-based linter and formatter
- `typescript: ^5` - TypeScript compiler
- `tailwindcss: ^3` - Utility-first CSS framework
- `@types/*` - TypeScript type definitions

## Best Practices

1. **Server Components First** - Add "use client" only when needed
2. **Server Actions for Mutations** - No API routes required
3. **Code Quality** - Run `npm run check` before committing (format + lint + typecheck)
4. **Error Boundaries** - Better debugging context for dev3000
5. **Logging** - Use console.log/error; dev3000 captures all output

### Why Biome?

Biome is the modern replacement for ESLint and Prettier, written in Rust for maximum speed:
- **10-100x faster** than ESLint/Prettier
- **All-in-one** tool for linting and formatting
- **Next.js optimized** with React hooks and TypeScript support
- **Zero config** needed - works out of the box
- **Fast feedback** during development

## Troubleshooting

### Port Conflicts
- Ports 3000, 3684, 9222 must be available
- Modify `docker-compose.yml` if needed

### Chrome CDP Issues
- Ensure Chrome runs on host
- Check `DEV3000_CDP_URL` environment variable
- Verify `host.docker.internal` works

### Code Quality

**Formatting** (Biome - Ultra-fast Rust-based formatter):
```bash
npm run format        # Format all files
npm run format:check  # Check formatting without changes
```

**Linting** (Biome - 10-100x faster than ESLint):
```bash
npm run lint       # Check for linting issues
npm run lint:fix   # Auto-fix linting issues
```

**Type Checking** (TypeScript):
```bash
npm run typecheck  # Check for type errors
```

**All Checks** (Format + Lint + TypeCheck):
```bash
npm run check      # Run all quality checks
```

## Learn More

- [Next.js 16 Documentation](https://nextjs.org/docs)
- [dev3000 Repository](https://github.com/automationjp/dev3000)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [React 19 Documentation](https://react.dev/)
