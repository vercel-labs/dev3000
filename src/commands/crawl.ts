/**
 * d3k crawl - Discover URLs by crawling the app
 *
 * Uses agent-browser to navigate the app and discover all linked pages.
 * Outputs a list of discovered URLs.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import chalk from "chalk"

export interface CrawlOptions {
  depth?: string // 1, 2, 3, or "all"
  limit?: string // max links per page
}

interface Session {
  projectName: string
  appPort: string
  cdpUrl?: string
}

function findActiveSessions(): Session[] {
  const sessionDir = join(homedir(), ".d3k")
  if (!existsSync(sessionDir)) {
    return []
  }

  try {
    const entries = readdirSync(sessionDir, { withFileTypes: true })
    const sessions: Session[] = []

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const sessionFile = join(sessionDir, entry.name, "session.json")
        if (existsSync(sessionFile)) {
          try {
            const content = JSON.parse(readFileSync(sessionFile, "utf-8"))
            if (content.pid) {
              try {
                process.kill(content.pid, 0)
                sessions.push(content)
              } catch {
                // Process not running
              }
            }
          } catch {
            // Skip invalid files
          }
        }
      }
    }

    return sessions
  } catch {
    return []
  }
}

function runAgentBrowser(args: string[]): { success: boolean; output: string } {
  try {
    const result = spawnSync("d3k", ["agent-browser", "--cdp", "9222", ...args], {
      encoding: "utf-8",
      timeout: 30000
    })

    if (result.status === 0) {
      return { success: true, output: result.stdout || "" }
    } else {
      return { success: false, output: result.stderr || result.stdout || "Unknown error" }
    }
  } catch (error) {
    return { success: false, output: error instanceof Error ? error.message : String(error) }
  }
}

export async function crawlApp(options: CrawlOptions): Promise<void> {
  const maxDepth = options.depth === "all" ? 10 : parseInt(options.depth || "1", 10)
  const limitPerPage = parseInt(options.limit || "3", 10)

  const sessions = findActiveSessions()

  if (sessions.length === 0) {
    console.log(chalk.red("❌ No active d3k sessions found."))
    console.log(chalk.gray("Make sure d3k is running first."))
    process.exit(1)
  }

  const session = sessions[0]
  const appPort = session.appPort || "3000"
  const baseUrl = `http://localhost:${appPort}`

  console.log(chalk.cyan(`🕷️ Crawling ${baseUrl}`))
  console.log(chalk.gray(`   Depth: ${options.depth === "all" ? "exhaustive" : maxDepth}`))
  console.log(chalk.gray(`   Links per page: ${limitPerPage}`))
  console.log()

  const discoveredUrls = new Set<string>([baseUrl])
  const visitedUrls = new Set<string>()
  const urlsToVisit: Array<{ url: string; depth: number }> = [{ url: baseUrl, depth: 0 }]

  while (urlsToVisit.length > 0) {
    const item = urlsToVisit.shift()
    if (!item) continue
    const { url, depth } = item

    if (visitedUrls.has(url) || depth > maxDepth) {
      continue
    }

    visitedUrls.add(url)
    console.log(chalk.gray(`  Visiting: ${url}`))

    // Navigate to the URL
    const navResult = runAgentBrowser(["open", url])
    if (!navResult.success) {
      console.log(chalk.yellow(`    ⚠️ Failed to navigate: ${navResult.output.slice(0, 100)}`))
      continue
    }

    // Wait for page to load
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Extract links using eval
    const evalResult = runAgentBrowser([
      "eval",
      `JSON.stringify(Array.from(document.querySelectorAll('a[href]')).map(a => a.href).filter(href => href.startsWith(window.location.origin)).slice(0, ${limitPerPage}))`
    ])

    if (evalResult.success) {
      try {
        // Parse the JSON output from agent-browser
        const output = evalResult.output.trim()
        // Extract JSON from potential wrapper
        const jsonMatch = output.match(/\[.*\]/s)
        if (jsonMatch) {
          const links = JSON.parse(jsonMatch[0]) as string[]

          for (const link of links) {
            // Normalize URL (remove query params and hash for deduplication)
            const normalized = link.split("?")[0].split("#")[0]
            if (!discoveredUrls.has(normalized)) {
              discoveredUrls.add(normalized)
              urlsToVisit.push({ url: normalized, depth: depth + 1 })
            }
          }
        }
      } catch {
        // Failed to parse links, continue
      }
    }
  }

  console.log()
  console.log(chalk.green(`✅ Crawl complete!`))
  console.log()
  console.log(chalk.cyan(`Discovered ${discoveredUrls.size} URLs:`))
  Array.from(discoveredUrls)
    .sort()
    .forEach((url) => {
      console.log(`  • ${url}`)
    })
}
