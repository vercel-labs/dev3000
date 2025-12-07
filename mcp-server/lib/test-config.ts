/**
 * Test configuration for workflow end-to-end testing
 * Contains selectors, URLs, and other test constants
 */

export const TEST_SELECTORS = {
  /** Start Workflow button in the new workflow modal */
  START_WORKFLOW_BUTTON: "body > div:nth-child(2) > div > div > div > div:nth-child(3) > div.flex.gap-3.mt-6 > button"
} as const

export const TEST_CONFIG = {
  /** Example workflow creation URL with pre-filled params */
  EXAMPLE_WORKFLOW_URL:
    "http://localhost:3000/workflows/new?type=cloud-fix&team=team_AOfCfb0WM8wEQYM5swopmVwn&project=prj_9kvdjxXYqydZsyifQmpbfjimvjHv",

  /** Golden preview URLs for tailwind-plus-transmit example project */
  GOLDEN_PREVIEW_URLS: [
    "https://tailwind-plus-transmit-git-main-lindsey-simons-projects.vercel.app",
    "https://tailwind-plus-transmit-1si3qaqhx-lindsey-simons-projects.vercel.app"
  ],

  /** Screenshot comparison path (root of the app) */
  SCREENSHOT_PATH: "/",

  /** Time to wait for page load before capturing screenshot (ms) */
  PAGE_LOAD_WAIT: 3000
} as const
