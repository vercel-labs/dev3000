# Changelog Management

This document explains how the changelog system works for dev3000.

## Overview

The changelog is automatically maintained at `/changelog` on the website and is updated during each release.

## How It Works

1. **Automatic Updates**: The `scripts/update-changelog.js` script runs during releases
2. **Git Analysis**: Extracts commit messages since the last release
3. **Highlight Extraction**: Identifies important changes and features
4. **Version Classification**: Determines if it's a major, minor, or patch release
5. **Page Update**: Updates `www/app/changelog/page.tsx` with the new entry

## Manual Updates

To manually add a changelog entry:

```bash
node scripts/update-changelog.js "v1.2.3"
```

## Changelog Entry Format

Each changelog entry includes:
- **Version**: The release version number
- **Date**: Release date in YYYY-MM-DD format  
- **Type**: major, minor, or patch
- **Highlights**: 3-4 key improvements/features

## Commit Message Best Practices

To ensure good changelog generation, write clear commit messages:

✅ **Good examples:**
- "Add periodic health checks for process monitoring"
- "Implement magical MCP tool descriptions" 
- "Fix error reporting with recent log lines"
- "Create automated background monitoring tools"

❌ **Skip these (auto-filtered):**
- "Merge pull request #123"
- "Bump to v1.2.3-canary"
- "Fix formatting after release"
- "Generated with Claude Code"

## Version Types

- **Major (x.0.0)**: Breaking changes, major new features
- **Minor (x.y.0)**: New features, significant improvements
- **Patch (x.y.z)**: Bug fixes, small improvements

## Integration with Release Process

The changelog update is integrated into `scripts/release.sh`:

1. Version is bumped
2. Changelog is updated automatically
3. Both changes are committed together
4. Release tag is created and pushed

## Viewing the Changelog

The changelog is available at:
- **Website**: https://dev3000.ai/changelog
- **Local**: http://localhost:3000/changelog (when running www)

## Retrospective Updates

For retroactive changelog entries (like the initial versions), manually edit the `changelog` array in `www/app/changelog/page.tsx`.