/**
 * Feature flag for enabling intentional CLS bugs in demo mode
 *
 * When enabled, the following bugs are introduced:
 * - ChangelogLink: Hydration mismatch causing nav shift
 * - Terminal recording: Layout shift on content load
 *
 * This allows us to demonstrate dev3000's CLS detection capabilities
 * without shipping bugs to production.
 *
 * Control via:
 * 1. Environment variable NEXT_PUBLIC_DEMO_CLS_BUGS=true
 * 2. Vercel Dashboard (production overrides)
 */
export function demoCLSBugsFlag() {
  // Default to false (no bugs) in production
  // Can be overridden via environment variable
  return process.env.NEXT_PUBLIC_DEMO_CLS_BUGS === "true"
}
