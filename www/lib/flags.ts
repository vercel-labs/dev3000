import { flag, precompute } from "flags/next"

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
 * 1. Vercel Toolbar (local development) - toggle in real-time
 * 2. Environment variable NEXT_PUBLIC_DEMO_CLS_BUGS=true
 * 3. Vercel Dashboard (production overrides)
 */
export const demoCLSBugsFlag = flag({
  key: "demo-cls-bugs",
  async decide() {
    // Default to false (no bugs) in production
    // Can be overridden via Vercel dashboard, toolbar, or environment variable
    return process.env.NEXT_PUBLIC_DEMO_CLS_BUGS === "true"
  }
})

export const precomputedFlags = precompute([demoCLSBugsFlag])
