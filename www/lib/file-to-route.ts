/**
 * Maps changed file paths to URL routes for before/after screenshot capture
 */

export interface RouteMapping {
  filePath: string
  route: string
  isDynamic: boolean
}

/**
 * Map an array of changed file paths to their corresponding URL routes.
 * Only includes files that represent actual pages (not components, utilities, etc.)
 */
export function mapFilesToRoutes(changedFiles: string[]): RouteMapping[] {
  const mappings: RouteMapping[] = []

  for (const filePath of changedFiles) {
    const mapping = filePathToRoute(filePath)
    if (mapping) {
      mappings.push(mapping)
    }
  }

  return mappings
}

/**
 * Convert a single file path to a route mapping, or null if not a page file
 */
function filePathToRoute(filePath: string): RouteMapping | null {
  // Normalize path separators
  const normalizedPath = filePath.replace(/\\/g, "/")

  // App Router: app/**/page.tsx (or .jsx, .ts, .js)
  const appRouterMatch = normalizedPath.match(/^(?:src\/)?app\/(.*)\/page\.(tsx?|jsx?)$/)
  if (appRouterMatch) {
    const routePath = appRouterMatch[1]
    const route = appRouterPathToRoute(routePath)
    const isDynamic = route.includes("[")
    return { filePath, route, isDynamic }
  }

  // App Router: app/page.tsx (root page)
  const appRootMatch = normalizedPath.match(/^(?:src\/)?app\/page\.(tsx?|jsx?)$/)
  if (appRootMatch) {
    return { filePath, route: "/", isDynamic: false }
  }

  // Pages Router: pages/**/*.tsx (but not _app, _document, api/)
  const pagesRouterMatch = normalizedPath.match(/^(?:src\/)?pages\/(.+)\.(tsx?|jsx?)$/)
  if (pagesRouterMatch) {
    const pagePath = pagesRouterMatch[1]

    // Skip special files and API routes
    if (pagePath.startsWith("_") || pagePath.startsWith("api/") || pagePath === "api") {
      return null
    }

    const route = pagesRouterPathToRoute(pagePath)
    const isDynamic = route.includes("[")
    return { filePath, route, isDynamic }
  }

  // Not a page file
  return null
}

/**
 * Convert App Router path segments to a URL route
 * - Strips route groups: (marketing)/about -> /about
 * - Preserves dynamic segments: products/[id] -> /products/[id]
 */
function appRouterPathToRoute(routePath: string): string {
  const segments = routePath.split("/")
  const cleanSegments: string[] = []

  for (const segment of segments) {
    // Skip route groups (parentheses)
    if (segment.startsWith("(") && segment.endsWith(")")) {
      continue
    }
    // Skip parallel routes (@)
    if (segment.startsWith("@")) {
      continue
    }
    // Skip intercepting routes (.)
    if (segment.startsWith("(.)") || segment.startsWith("(..)")) {
      continue
    }
    cleanSegments.push(segment)
  }

  const route = `/${cleanSegments.join("/")}`
  return route === "/" ? "/" : route.replace(/\/$/, "")
}

/**
 * Convert Pages Router path to a URL route
 * - index -> /
 * - about -> /about
 * - products/[id] -> /products/[id]
 */
function pagesRouterPathToRoute(pagePath: string): string {
  // Remove index suffix
  let route = pagePath.replace(/\/index$/, "").replace(/^index$/, "")

  // Ensure leading slash
  route = `/${route}`

  // Clean up
  return route === "/" ? "/" : route.replace(/\/$/, "")
}

/**
 * Filter route mappings to get the best routes for screenshots.
 * Prefers static routes over dynamic ones. Limits to maxRoutes.
 */
export function filterPageRoutes(mappings: RouteMapping[], maxRoutes = 3): string[] {
  // Sort: static routes first, then by route length (shorter = more important)
  const sorted = [...mappings].sort((a, b) => {
    // Static routes first
    if (a.isDynamic !== b.isDynamic) {
      return a.isDynamic ? 1 : -1
    }
    // Shorter routes first (root page, main sections)
    return a.route.length - b.route.length
  })

  // Take up to maxRoutes, preferring static
  const selected: string[] = []
  const seen = new Set<string>()

  for (const mapping of sorted) {
    if (selected.length >= maxRoutes) break

    // Skip duplicates
    if (seen.has(mapping.route)) continue
    seen.add(mapping.route)

    // For dynamic routes, skip catch-all patterns
    if (mapping.route.includes("[...")) continue

    selected.push(mapping.route)
  }

  return selected
}
