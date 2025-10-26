# Package Update Plan for dev3000

## Summary of Changes Made

1. **Centralized Package Management**: Moved all shared dependencies to the pnpm workspace catalog
2. **Unified Versions**: All workspaces now use the same versions for shared dependencies

## Packages to Update

### Critical Updates (Major Version Changes)

These require careful testing:

1. **commander**: 11.1.0 → 14.0.1 (Major)
   - Used in root and mcp-server
   - Breaking changes may exist

2. **zod**: 3.25.76 → 4.1.11 (Major)
   - Used across all workspaces
   - Check for API changes

3. **vitest**: 1.6.1 → 3.2.4 (Major)
   - Test runner - check for config changes

### Minor Updates (Should be Safe)

1. **@types/node**: 22.18.6 → 24.5.2
2. **ora**: 8.2.0 → 9.0.0
3. **tw-animate-css**: 1.3.3 → 1.3.8
4. **lucide-react**: 0.454.0 → 0.544.0
5. **next**: 15.5.1-canary.30 → 15.5.4 (or stay on canary)

### Radix UI Updates (All Minor)

All Radix UI components have minor updates available. These should be safe to update as a batch.

## Update Commands

### Option 1: Conservative Update (Recommended)

Update minor versions first:
```bash
# Update type definitions and minor versions
pnpm update @types/node@^24.5.2 --workspace-root
pnpm update tw-animate-css@^1.3.8 --workspace-root
pnpm update lucide-react@^0.544.0 --workspace-root

# Update all Radix UI components to latest 1.x versions
pnpm update "@radix-ui/*@^1" --workspace-root
```

### Option 2: Update All (After Testing)

```bash
# Update all packages in catalog to latest
pnpm update --latest --workspace-root

# Or update specific major versions after testing
pnpm update commander@^14.0.1 --workspace-root
pnpm update zod@^4.1.11 --workspace-root
pnpm update vitest@^3.2.4 --workspace-root
```

## Testing Plan

1. Run `pnpm test` after updates
2. Run `pnpm run typecheck` 
3. Run `pnpm run lint`
4. Test the CLI with `pnpm run canary`
5. Test browser monitoring functionality
6. Test MCP server endpoints

## Notes

- The React canary version is intentional - don't update unless needed
- Next.js canary is also intentional for cutting-edge features
- Some peer dependency warnings are expected with canary versions