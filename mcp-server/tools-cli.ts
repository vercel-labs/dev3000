#!/usr/bin/env tsx

/**
 * CLI interface for dev3000 MCP tools
 * This demonstrates how the extracted tool functions can be used outside of the MCP server
 *
 * Usage:
 *   tsx tools-cli.ts fix [options]
 *   tsx tools-cli.ts browser <action> [params]
 */

import { Command } from "commander"
import { executeBrowserAction, fixMyApp } from "./app/mcp/tools"

const program = new Command()

program.name("d3k-tools").description("CLI for dev3000 MCP tools").version("1.0.0")

// Fix my app command
program
  .command("fix")
  .description("Analyze and fix errors in your application")
  .option("-p, --project <name>", "Project name if multiple dev3000 instances are running")
  .option("-a, --area <area>", "Focus area: build, runtime, network, ui, all", "all")
  .option("-m, --mode <mode>", "Fix mode: snapshot, bisect, monitor", "snapshot")
  .option("-t, --time <minutes>", "Minutes to analyze back from now", "10")
  .option("-w, --wait", "Wait for user interaction (bisect mode)", false)
  .action(async (options) => {
    const result = await fixMyApp({
      projectName: options.project,
      focusArea: options.area,
      mode: options.mode as "snapshot" | "bisect" | "monitor",
      timeRangeMinutes: parseInt(options.time),
      waitForUserInteraction: options.wait,
      includeTimestampInstructions: true
    })

    // Output the result
    for (const content of result.content) {
      console.log(content.text)
    }
  })

// Browser action command
program
  .command("browser <action>")
  .description("Execute browser actions")
  .option("-x <x>", "X coordinate for click/scroll", parseInt)
  .option("-y <y>", "Y coordinate for click/scroll", parseInt)
  .option("-u, --url <url>", "URL for navigate action")
  .option("-t, --text <text>", "Text for type action")
  .option("-e, --expression <expr>", "JavaScript expression for evaluate")
  .option("--deltaX <delta>", "Scroll delta X", parseInt)
  .option("--deltaY <delta>", "Scroll delta Y", parseInt)
  .action(async (action, options) => {
    // Build params object based on action
    const params: Record<string, unknown> = {}

    switch (action) {
      case "click":
        if (options.x !== undefined) params.x = options.x
        if (options.y !== undefined) params.y = options.y
        break
      case "navigate":
        if (options.url) params.url = options.url
        break
      case "type":
        if (options.text) params.text = options.text
        break
      case "evaluate":
        if (options.expression) params.expression = options.expression
        break
      case "scroll":
        if (options.x !== undefined) params.x = options.x
        if (options.y !== undefined) params.y = options.y
        if (options.deltaX !== undefined) params.deltaX = options.deltaX
        if (options.deltaY !== undefined) params.deltaY = options.deltaY
        break
    }

    const result = await executeBrowserAction({ action, params })

    // Output the result
    for (const content of result.content) {
      console.log(content.text)
    }
  })

// Examples command
program
  .command("examples")
  .description("Show usage examples")
  .action(() => {
    console.log(`
Examples:

  # Fix errors in current project
  $ tsx tools-cli.ts fix

  # Fix errors in specific project with 5 minute window
  $ tsx tools-cli.ts fix --project my-app --time 5

  # Monitor mode for continuous checking
  $ tsx tools-cli.ts fix --mode monitor

  # Bisect mode to capture before/after
  $ tsx tools-cli.ts fix --mode bisect --wait
  
  # Click at coordinates
  $ tsx tools-cli.ts browser click -x 100 -y 200
  
  # Navigate to URL
  $ tsx tools-cli.ts browser navigate --url https://example.com
  
  # Type text
  $ tsx tools-cli.ts browser type --text "Hello World"
  
  # Scroll page
  $ tsx tools-cli.ts browser scroll --deltaY 500
    `)
  })

program.parse()
