# dev3000 Documentation

Complete documentation for dev3000 - AI-powered development tools with browser monitoring and MCP server integration.

## Quick Navigation

### 📚 User Guides

Start here if you're using dev3000 for the first time or want to learn about features:

- **[Getting Started](user-guide/getting-started.md)** - Complete guide from installation to production-ready debugging
- **[Docker Setup Guide](user-guide/docker-setup.md)** - Running dev3000 in Docker (required for Windows/WSL2)
- **[MCP Setup](user-guide/mcp-setup.md)** - Setting up Model Context Protocol for AI integration
- **[Performance Guide](user-guide/performance.md)** - Optimization tips for Next.js and Docker environments

### 💻 Developer Documentation

For contributors and developers working on dev3000 itself:

- **[Claude Code Guide](../CLAUDE.md)** - Comprehensive development guide for Claude Code (root level)
- **[Agents Guide](../AGENTS.md)** - Abbreviated guidance for AI agents (root level)
- **[Release Process](developer/release-process.md)** - How to release new versions
- **[Changelog Management](developer/changelog-management.md)** - How the changelog system works

### 📖 Examples & Tutorials

Practical examples and use cases:

- **[Error Monitoring with Claude](examples/error-monitoring-with-claude.md)** - Using dev3000 with AI for debugging

### 📦 Component-Specific Documentation

Documentation for specific parts of the project:

- **[Chrome Extension](../chrome-extension/README.md)** - Browser extension for lightweight monitoring
- **[Docker Configuration](../docker/README.md)** - Docker-specific setup and architecture
- **[Frontend Example](../frontend/README.md)** - Next.js 16 example application
- **[Example Apps](../example/nextjs16/README.md)** - Sample applications for testing

### 📜 Archive

Historical documentation and implementation notes (for reference):

- **[Archive](archive/)** - Deprecated documentation and implementation notes

## Documentation Structure

```
docs/
├── README.md                           # This file - documentation index
├── user-guide/                         # User-facing documentation
│   ├── getting-started.md             # Installation and first steps
│   ├── docker-setup.md                # Docker/WSL2 setup
│   ├── mcp-setup.md                   # MCP integration
│   └── performance.md                 # Performance optimization
├── developer/                          # Developer documentation
│   ├── release-process.md             # Release workflow
│   └── changelog-management.md        # Changelog system
├── examples/                           # Tutorials and examples
│   └── error-monitoring-with-claude.md
└── archive/                            # Historical documentation
    ├── CHANGELOG-SSE-FIX.md
    ├── DOCKER_WSL_IMPLEMENTATION_ISSUE.md
    ├── DOCKER_WSL_FEATURE_IMPLEMENTATION.md
    └── update-packages.md
```

## Getting Help

- **Issues**: [GitHub Issues](https://github.com/automationjp/dev3000/issues)
- **Main README**: [Project Overview](../README.md)
- **Changelog**: [Release History](../CHANGELOG.md)

## Contributing to Documentation

When updating documentation:

1. **User guides** should be beginner-friendly and include examples
2. **Developer docs** can be more technical and assume familiarity
3. **Keep it current** - update links when files move
4. **Test all links** - ensure internal links work after changes
5. **Follow structure** - place new docs in the appropriate directory

See the [Claude Code Guide](developer/claude-code.md) for code contribution guidelines.
