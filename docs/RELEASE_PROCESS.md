# Release Process

This document describes how to release new versions of dev3000.

## Prerequisites

1. Ensure all changes are committed and pushed to main
2. Ensure all tests are passing
3. Have npm 2FA configured (required for publishing)

## Release Methods

### Method 1: GitHub Actions + Manual Publish (Recommended)

1. Go to the [Actions tab](https://github.com/vercel-labs/dev3000/actions) on GitHub
2. Click on "Prepare Release" workflow
3. Click "Run workflow"
4. Select release type (patch/minor/major) and click "Run workflow"

The workflow will:
- Run all tests on multiple platforms (Ubuntu/macOS, Node 18/20)
- Run Docker tests in minimal environments
- Create git tags and update changelog
- Build and pack the release
- Upload the tarball as an artifact
- Provide instructions for completing the release

5. After the workflow completes successfully:
   - Download the release artifact (dev3000-*.tgz) from the workflow run
   - Run `npm publish dev3000-*.tgz` locally (requires 2FA)
   - Create a GitHub release manually

### Method 2: Local Release (Current Process)

1. Run locally:
   ```bash
   ./scripts/release.sh
   ```
   This creates tags and updates the changelog.

2. Publish to npm (requires 2FA):
   ```bash
   ./scripts/publish.sh
   ```

3. Push changes:
   ```bash
   git push origin main --tags
   ```

## Testing Before Release

The release process automatically runs:

1. **Unit tests** - `pnpm run test`
2. **Linting** - `pnpm run lint`
3. **Type checking** - `pnpm run typecheck`
4. **Clean install tests** - Tests installation with npm/pnpm in clean environments
5. **Docker tests** - Tests in minimal Docker containers (CI only)
6. **Matrix tests** - Tests on Ubuntu/macOS with Node 18/20

## Canary Releases

For testing releases before going to stable:

```bash
./scripts/canary.sh
```

This builds and installs locally for testing.

## Rollback

If a bad release is published:

1. Mark the version as deprecated on npm:
   ```bash
   npm deprecate dev3000@x.x.x "This version has issues, please use x.x.x"
   ```

2. Publish a patch fix immediately

## NPM 2FA Requirement

npm requires Two-Factor Authentication for publishing packages. This means:
- Automated publishing from CI/CD is not possible
- You must run `npm publish` locally with your 2FA code
- The GitHub Actions workflow prepares everything but final publish is manual

## Security

- npm requires 2FA for all publishes
- GitHub Actions tests on multiple platforms before release
- All releases are tagged and traceable to commits