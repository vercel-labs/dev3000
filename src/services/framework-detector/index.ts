/**
 * Framework Detection Service
 * Detects project type and provides configuration
 */

import { NodeDetector } from "./detectors/node.js"
import { PythonDetector } from "./detectors/python.js"
import { RailsDetector } from "./detectors/rails.js"
import type { DetectOptions, FrameworkDetector, ProjectConfig } from "./types.js"

export class FrameworkDetectorService {
  private detectors: FrameworkDetector[]

  constructor() {
    // Order matters - more specific detectors first, Node as fallback
    this.detectors = [new PythonDetector(), new RailsDetector(), new NodeDetector()]
  }

  /**
   * Detect project type and return configuration
   */
  async detect(options: DetectOptions = {}): Promise<ProjectConfig> {
    const { debug = false } = options

    // Try each detector in order
    for (const detector of this.detectors) {
      const canDetect = await detector.canDetect()
      if (canDetect) {
        if (debug) {
          console.log(`[PROJECT DEBUG] ${detector.getDebugMessage()}`)
        }

        const config = await detector.getConfig(debug)
        return {
          type: detector.getType(),
          ...config,
          defaultPort: detector.getDefaultPort()
        }
      }
    }

    // This shouldn't happen since Node is a fallback, but just in case
    throw new Error("No framework detector could handle this project")
  }
}
