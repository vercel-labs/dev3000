/**
 * d3k find-component - Find React component source for a DOM selector
 *
 * Uses agent-browser to inspect DOM elements and extract React component info.
 * Returns grep patterns to locate the source file.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import chalk from "chalk"

interface Session {
  projectName: string
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

export async function findComponent(selector: string): Promise<void> {
  const sessions = findActiveSessions()

  if (sessions.length === 0) {
    console.log(chalk.red("❌ No active d3k sessions found."))
    console.log(chalk.gray("Make sure d3k is running first."))
    process.exit(1)
  }

  console.log(chalk.cyan(`🔍 Finding component for: ${selector}`))
  console.log()

  // JavaScript to extract React component info from DOM element
  const extractScript = `
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return JSON.stringify({ error: 'Element not found' });

      // Find React Fiber
      const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
      if (!fiberKey) return JSON.stringify({ error: 'Not a React element' });

      let fiber = el[fiberKey];
      let componentSource = null;
      let componentName = null;

      // Walk up the fiber tree to find a function component
      while (fiber) {
        if (typeof fiber.type === 'function') {
          componentName = fiber.type.displayName || fiber.type.name || 'Anonymous';
          try {
            componentSource = fiber.type.toString().slice(0, 2000);
          } catch (e) {
            componentSource = null;
          }
          break;
        }
        fiber = fiber.return;
      }

      // Extract useful patterns from the component source
      const patterns = [];
      if (componentSource) {
        // Find JSX component references like <Button, <Card
        const jsxMatches = componentSource.match(/<([A-Z][a-zA-Z0-9]+)/g);
        if (jsxMatches) {
          jsxMatches.forEach(m => patterns.push(m.slice(1)));
        }

        // Find className patterns
        const classMatches = componentSource.match(/className[=:]\\s*["'\`]([^"'\`]+)["'\`]/g);
        if (classMatches) {
          classMatches.slice(0, 3).forEach(m => {
            const cls = m.match(/["'\`]([^"'\`]+)["'\`]/);
            if (cls) patterns.push('className.*' + cls[1].split(' ')[0]);
          });
        }
      }

      return JSON.stringify({
        componentName,
        patterns,
        sourcePreview: componentSource ? componentSource.slice(0, 500) : null
      });
    })()
  `

  const result = runAgentBrowser(["eval", extractScript])

  if (!result.success) {
    console.log(chalk.red(`❌ Failed to inspect element: ${result.output}`))
    process.exit(1)
  }

  try {
    // Extract JSON from output
    const jsonMatch = result.output.match(/\{.*\}/s)
    if (!jsonMatch) {
      console.log(chalk.red("❌ Could not parse response"))
      console.log(chalk.gray(result.output))
      process.exit(1)
    }

    const data = JSON.parse(jsonMatch[0])

    if (data.error) {
      console.log(chalk.red(`❌ ${data.error}`))
      if (data.error === "Element not found") {
        console.log(chalk.gray(`Make sure the selector "${selector}" matches an element on the page.`))
      } else if (data.error === "Not a React element") {
        console.log(chalk.gray("This element doesn't appear to be rendered by React."))
      }
      process.exit(1)
    }

    console.log(chalk.green(`✅ Found component: ${data.componentName || "Unknown"}`))
    console.log()

    if (data.patterns && data.patterns.length > 0) {
      console.log(chalk.cyan("Search patterns to find source file:"))
      console.log()

      // Component name pattern
      if (data.componentName && data.componentName !== "Anonymous") {
        console.log(chalk.white(`  grep -r "function ${data.componentName}" src/`))
        console.log(chalk.white(`  grep -r "const ${data.componentName}" src/`))
        console.log(chalk.white(`  grep -r "export.*${data.componentName}" src/`))
      }

      // Additional patterns
      data.patterns.slice(0, 5).forEach((pattern: string) => {
        console.log(chalk.gray(`  grep -r "${pattern}" src/`))
      })
    }

    if (data.sourcePreview) {
      console.log()
      console.log(chalk.cyan("Source preview (transpiled):"))
      console.log(chalk.gray("─".repeat(50)))
      console.log(chalk.gray(data.sourcePreview))
      console.log(chalk.gray("─".repeat(50)))
    }
  } catch {
    console.log(chalk.red(`❌ Failed to parse component info`))
    console.log(chalk.gray(result.output.slice(0, 500)))
    process.exit(1)
  }
}
