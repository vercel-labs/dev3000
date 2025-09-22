/**
 * Node.js framework detector
 */

import { detect } from "package-manager-detector"
import type { FrameworkConfig, FrameworkDetector } from "../types.js"

export class NodeDetector implements FrameworkDetector {
  private detectedAgent: string | null = null

  async canDetect(): Promise<boolean> {
    // Node detector is the fallback, so it can always "detect"
    // But we'll check for actual package manager
    const detected = await detect()
    if (detected) {
      this.detectedAgent = detected.agent
      return true
    }
    // Even without detection, we fall back to npm
    return true
  }

  async getConfig(): Promise<FrameworkConfig> {
    // Re-detect if we haven't already
    if (this.detectedAgent === null) {
      const detected = await detect()
      this.detectedAgent = detected?.agent || null
    }
    const packageManager = this.detectedAgent || "npm"

    return {
      baseCommand: `${packageManager} run`,
      defaultScript: "dev"
    }
  }

  getDefaultPort(): string {
    return "3000"
  }

  getType(): "node" {
    return "node"
  }

  getDebugMessage(): string {
    if (this.detectedAgent) {
      return `Node.js project detected with ${this.detectedAgent} package manager`
    }
    return "No project files detected, defaulting to Node.js with npm"
  }
}
