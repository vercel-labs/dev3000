# Example Apps

These apps are intentionally small and intentionally imperfect. Each app targets one workflow type or dev-agent specialization so we can validate that the skill-driven workflows find real, human-like issues and propose meaningful fixes.

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

- `eliminate-waterfalls`
  - Dev agent: `Eliminate Waterfalls`
  - Skills expected: `d3k`, `vercel-react-best-practices`
  - Intentional issues:
    - Sequential server data fetching on the main route
    - Per-item server fetch loop in a child component
    - Async work started later than necessary

- `bundle-size-optimizer`
  - Dev agent: `Bundle Size Optimizer`
  - Skills expected: `d3k`, `vercel-react-best-practices`
  - Intentional issues:
    - Route marked as a top-level client component unnecessarily
    - Large static catalog imported directly into the route bundle
    - Heavy low-value widget imported before user intent

- `server-side-perf-optimizer`
  - Dev agent: `Server-Side Perf Optimizer`
  - Skills expected: `d3k`, `vercel-react-best-practices`
  - Intentional issues:
    - Duplicate server fetches across page and child components
    - Sequential request-time work on the server
    - Oversized payload serialized into a client component

- `client-side-fetch-optimizer`
  - Dev agent: `Client-Side Fetch Optimizer`
  - Skills expected: `d3k`, `vercel-react-best-practices`
  - Intentional issues:
    - Multiple widgets fetching the same endpoint independently
    - Duplicate resize listeners
    - Repeated localStorage reads instead of shared client state

- `re-render-optimizer`
  - Dev agent: `Re-render Optimizer`
  - Skills expected: `d3k`, `vercel-react-best-practices`
  - Intentional issues:
    - Large array rebuilt on every render
    - Derived state stored in effects
    - High-frequency transient values kept in React state

- `cls-fix`
  - Workflow type: `cls-fix`
  - Skills expected: `d3k`
  - Intentional issues:
    - Banner inserted after page load without reserving space
    - Large image without explicit dimensions

- `turbopack-bundle-analyzer`
  - Workflow type: `turbopack-bundle-analyzer`
  - Skills expected: `d3k`, `analyze-bundle`
  - Intentional issues:
    - Home page marked as a client component unnecessarily
    - Large static JSON payload imported directly into `/` bundle
    - Second large static payload imported for low-value UI sample content
    - Expensive client-side filtering/sorting of the full payload

## Deployment

Each app is a standalone Next.js project and can be deployed as its own Vercel project.

Suggested setup:

1. Create one Vercel project per app, each with the root set to the app directory.
2. Connect to this repo and choose the appropriate root:
   - `example-apps/design-guidelines`
   - `example-apps/react-performance`
   - `example-apps/eliminate-waterfalls`
   - `example-apps/bundle-size-optimizer`
   - `example-apps/server-side-perf-optimizer`
   - `example-apps/client-side-fetch-optimizer`
   - `example-apps/re-render-optimizer`
   - `example-apps/cls-fix`
   - `example-apps/turbopack-bundle-analyzer`
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
- Eliminate Waterfalls should flatten obvious async chains and remove sequential server waits.
- Bundle Size Optimizer should reduce shipped JS on `/` by removing, deferring, or server-shifting heavy code.
- Server-Side Perf Optimizer should deduplicate server fetches and narrow serialized payloads.
- Client-Side Fetch Optimizer should collapse duplicate browser requests and listeners behind shared logic.
- Re-render Optimizer should stop rebuilding large values and remove effect-driven derived state.
- CLS Fix should eliminate the banner shift and reserve space for media to prevent layout jump.
- Turbopack Bundle Analyzer should reduce shipped JS on `/` by removing or deferring the giant catalog payload.

## Deployment Note

These projects are connected to Git and intended to auto-deploy on push once linked in Vercel.
