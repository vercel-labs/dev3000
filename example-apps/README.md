# Example Apps

These apps are intentionally small and intentionally imperfect. Each app targets one workflow type so we can validate that the skill-driven workflows find real, human-like issues and propose meaningful fixes.

## Apps

- `design-guidelines`
  - Workflow type: `design-guidelines`
  - Skills expected: `d3k`, `vercel-design-guidelines`
  - Intentional issues:
    - Low contrast text on light backgrounds
    - Inconsistent spacing and typography scale
    - Overly long line lengths
    - CTA hierarchy and alignment inconsistencies

- `react-performance`
  - Workflow type: `react-performance`
  - Skills expected: `d3k`, `vercel-react-best-practices`
  - Intentional issues:
    - Sequential server data fetching (waterfall)
    - Expensive client-side render loop re-running every second
    - Large in-memory array built on every render

- `cls-fix`
  - Workflow type: `cls-fix`
  - Skills expected: `d3k`
  - Intentional issues:
    - Banner inserted after page load without reserving space
    - Large image without explicit dimensions

## Deployment

Each app is a standalone Next.js project and can be deployed as its own Vercel project.

Suggested setup:

1. Create three Vercel projects, each with the root set to the app directory.
2. Connect to this repo and choose the appropriate root:
   - `example-apps/design-guidelines`
   - `example-apps/react-performance`
   - `example-apps/cls-fix`
3. Use the default Next.js build settings.

## Local Dev

Each app uses bun:

```bash
cd example-apps/<app-name>
bun install
bun run dev
```

## Testing Expectations

When running workflows against these apps:

- Design Guidelines Review should suggest concrete improvements to color contrast, spacing, typography, and CTA hierarchy.
- React Performance Review should parallelize data fetching and reduce expensive client-side renders.
- CLS Fix should eliminate the banner shift and reserve space for media to prevent layout jump.
