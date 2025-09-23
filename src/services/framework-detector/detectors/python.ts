/**
 * Python framework detector
 */

import { execSync } from "child_process"
import { existsSync } from "fs"
import type { FrameworkConfig, FrameworkDetector } from "../types.js"

export class PythonDetector implements FrameworkDetector {
  async canDetect(): Promise<boolean> {
    return existsSync("requirements.txt") || existsSync("pyproject.toml")
  }

  getConfig(debug = false): FrameworkConfig {
    const baseCommand = this.detectPythonCommand(debug)

    return {
      baseCommand,
      defaultScript: "main.py"
    }
  }

  getDefaultPort(): string {
    return "8000" // Common Python web server port
  }

  getType(): "python" {
    return "python"
  }

  getDebugMessage(): string {
    return "Python project detected (found requirements.txt or pyproject.toml)"
  }

  private detectPythonCommand(debug = false): string {
    // Check if we're in a virtual environment. If so, python already points to
    // the correct Python interpreter
    if (process.env.VIRTUAL_ENV) {
      if (debug) {
        console.log(`[PYTHON DEBUG] Virtual environment detected: ${process.env.VIRTUAL_ENV}`)
        console.log(`[PYTHON DEBUG] Using activated python command`)
      }
      return "python"
    }

    // Check if python3 is available and prefer it
    try {
      execSync("python3 --version", { stdio: "ignore" })
      if (debug) {
        console.log(`[PYTHON DEBUG] python3 is available, using python3`)
      }
      return "python3"
    } catch {
      // Try python as fallback
      try {
        execSync("python --version", { stdio: "ignore" })
        if (debug) {
          console.log(`[PYTHON DEBUG] python3 not available, falling back to python`)
        }
        return "python"
      } catch {
        // Python not found at all - return python anyway and let it fail with
        // clear error later
        if (debug) {
          console.log(`[PYTHON DEBUG] WARNING: Neither python3 nor python found in PATH`)
        }
        return "python"
      }
    }
  }
}
