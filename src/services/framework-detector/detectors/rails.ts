/**
 * Rails framework detector
 */

import { existsSync } from "fs"
import type { FrameworkConfig, FrameworkDetector } from "../types.js"

export class RailsDetector implements FrameworkDetector {
  async canDetect(): Promise<boolean> {
    return existsSync("Gemfile") && existsSync("config/application.rb")
  }

  getConfig(debug = false): FrameworkConfig {
    // Check for Procfile.dev, which indicates foreman/overmind setup with bin/dev
    if (existsSync("Procfile.dev")) {
      if (debug) {
        console.log(`[RAILS DEBUG] Found Procfile.dev - using bin/dev for process management`)
      }
      return {
        baseCommand: "bin/dev", // bin/dev is the command that accepts process names as arguments
        defaultScript: "" // No argument needed - bin/dev runs all processes by default
      }
    }

    // Standard Rails setup
    if (debug) {
      console.log(`[RAILS DEBUG] Standard Rails setup - using bundle exec rails`)
    }
    return {
      baseCommand: "bundle exec rails",
      defaultScript: "server"
    }
  }

  getDefaultPort(): string {
    return "3000" // Rails default port
  }

  getType(): "rails" {
    return "rails"
  }

  getDebugMessage(): string {
    return "Rails project detected (found Gemfile and config/application.rb)"
  }
}
