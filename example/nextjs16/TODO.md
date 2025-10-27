# TODOs for Next.js Frontend

## Performance & Build Optimizations

### Completed
- ✅ Enabled performance optimizations in `next.config.js`:
  - `optimizePackageImports` for React packages
  - `optimizeCss` for better CSS performance
  - `optimisticClientCache` for faster navigation
- ✅ Disabled static export (`output: 'export'`) due to Next.js 16 bugs
- ✅ Using Turbopack for faster builds

### Current Issues

#### Production Build Failure (Next.js 16 Bug)
**Status**: Blocked by upstream bug
**Issue**: Next.js 16.0.0 and 16.0.1-canary.2 both fail during production build with:
```
TypeError: Cannot read properties of null (reading 'useContext')
at /_global-error prerendering
```

**Impact**:
- Dev server works fine (http://localhost:3000)
- Production builds fail
- Related to Next.js Issue #82366 (similar bug in Next.js 15.4.5)

**Workarounds Attempted**:
1. ❌ Removing `output: 'export'` - Error persists
2. ❌ Deleting global-error.tsx - Error persists (Next.js generates internal version)
3. ❌ Upgrading to Next.js 16.0.1-canary.2 - Different TypeScript error

**Recommended Actions**:
1. Monitor Next.js releases for bug fix
2. Consider downgrading to Next.js 15.x if production builds are urgently needed
3. Use dev mode for development (currently working)

### Future Improvements

#### 1. Enable Static Site Generation (SSG)
**Priority**: High
**Description**: Re-enable `output: 'export'` for static site generation once Next.js 16 bug is fixed

**Benefits**:
- Faster page loads
- Better SEO
- Lower hosting costs (can use static hosting)
- Improved performance

**Requirements**:
- Next.js 16 useContext bug must be fixed
- Verify all pages are SSG-compatible:
  - No Server Actions (already verified)
  - No cookies() or headers() in components (already verified)
  - All dynamic routes need generateStaticParams()

**Configuration** (ready to enable when bug is fixed):
```javascript
// In next.config.js
output: 'export',
trailingSlash: true,
```

**Resources**:
- [Official Next.js Static Exports Guide](https://nextjs.org/docs/app/guides/static-exports)
- [Next.js Issue #82366](https://github.com/vercel/next.js/issues/82366) - Similar useContext bug

#### 2. Additional Performance Optimizations
**Priority**: Medium

Once production builds work, consider:
- Enable React Compiler when stable
- Implement image optimization (currently disabled)
- Add bundle analyzer to identify large dependencies
- Implement code splitting strategies
- Add caching headers for static assets

#### 3. Build Optimization
**Priority**: Medium

- Investigate Turbopack-specific optimizations
- Consider parallel build processing
- Optimize Docker layer caching for faster rebuilds

## Version Information
- Next.js: 16.0.1-canary.2 (attempted), currently running 16.0.0
- React: 19.1.0
- Node.js: >= 18.0.0

## Notes
- SSG enablement is awaiting Next.js bug fix
- Current config optimized for development speed
- Production builds currently not working due to Next.js bug
