/**
 * Types and interfaces for framework detection
 */

export interface ProjectConfig {
  type: "node" | "python" | "rails"
  baseCommand: string // Base command to prepend to script
  defaultScript: string // Default script to execute
  defaultPort: string
}

export interface FrameworkConfig {
  baseCommand: string
  defaultScript: string
}

export interface DetectOptions {
  debug?: boolean
}

export interface FrameworkDetector {
  /**
   * Check if this detector can handle the current project
   */
  canDetect(): boolean | Promise<boolean>

  /**
   * Get the configuration for this framework
   */
  getConfig(debug?: boolean): FrameworkConfig | Promise<FrameworkConfig>

  /**
   * Get the default port for this framework
   */
  getDefaultPort(): string

  /**
   * Get the framework type identifier
   */
  getType(): "node" | "python" | "rails"

  /**
   * Get debug message for when this framework is detected
   */
  getDebugMessage(): string
}
