/**
 * Tests for BaseErrorDetector with real-world error messages
 */

import { describe, expect, test } from "vitest"
import { BaseErrorDetector } from "../base.js"

describe("BaseErrorDetector", () => {
  const detector = new BaseErrorDetector()

  describe("Critical Errors - Should Return True", () => {
    test("Port and connection errors", () => {
      expect(detector.isCritical("Error: listen EADDRINUSE: address already in use :::3000")).toBe(true)
      expect(detector.isCritical("EACCES: permission denied, open '/etc/hosts'")).toBe(true)
      expect(detector.isCritical("ENOENT: no such file or directory, open 'package.json'")).toBe(true)
      expect(detector.isCritical("Error: connect ECONNREFUSED 127.0.0.1:5432")).toBe(true)
    })

    test("System-level critical errors", () => {
      expect(
        detector.isCritical("FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory")
      ).toBe(true)
      expect(detector.isCritical("Process terminated due to segmentation fault")).toBe(true)
      expect(detector.isCritical("PANIC: runtime error")).toBe(true)
      expect(detector.isCritical("Process killed with SIGKILL")).toBe(true)
    })

    test("Module/dependency errors (excluding warnings)", () => {
      // These should be flagged as critical
      expect(detector.isCritical("Cannot find module 'react'")).toBe(true)
      expect(detector.isCritical("Module not found: Can't resolve './components/Button'")).toBe(true)
      expect(detector.isCritical("Package not found: '@types/node'")).toBe(true)
    })

    test("Syntax and parsing errors (excluding warnings)", () => {
      // These should be flagged as critical
      expect(detector.isCritical("SyntaxError: Unexpected token '}'in JSON")).toBe(true)
      expect(detector.isCritical("Parse error: Expected ';' but found 'let'")).toBe(true)
      expect(detector.isCritical("Unexpected token 'export' in strict mode")).toBe(true)
    })
  })

  describe("Non-Critical Messages - Should Return False", () => {
    test("Warning messages should be excluded", () => {
      // These contain "warning" and should NOT be flagged as critical
      expect(detector.isCritical("warning: Cannot find module 'optional-dep' but continuing")).toBe(false)
      expect(detector.isCritical("WARNING: Module not found but this is optional")).toBe(false)
      expect(detector.isCritical("Package not found warning: peer dependency missing")).toBe(false)
      expect(detector.isCritical("SyntaxError warning: deprecated syntax detected")).toBe(false)
      expect(detector.isCritical("Parse error warning: outdated configuration")).toBe(false)
      expect(detector.isCritical("Unexpected token warning in legacy code")).toBe(false)
    })

    test("WARN level messages", () => {
      expect(detector.isCritical("WARN: Deprecated API usage detected")).toBe(false)
      expect(detector.isCritical("[WARN] Configuration file not found, using defaults")).toBe(false)
    })

    test("Deprecation messages", () => {
      expect(detector.isCritical("deprecated: This feature will be removed in v2")).toBe(false)
      expect(detector.isCritical("DEPRECATED: Use new API instead")).toBe(false)
    })

    test("Regular info/debug messages", () => {
      expect(detector.isCritical("Server running on http://localhost:3000")).toBe(false)
      expect(detector.isCritical("Compiling...")).toBe(false)
      expect(detector.isCritical("Ready in 1.2s")).toBe(false)
      expect(detector.isCritical("Hot reload enabled")).toBe(false)
    })
  })

  describe("Edge Cases", () => {
    test("Mixed case warning exclusions", () => {
      expect(detector.isCritical("Warning: Cannot find module but continuing")).toBe(false)
      expect(detector.isCritical("This is a WARNING about SyntaxError")).toBe(false)
      expect(detector.isCritical("deprecated warning about Module not found")).toBe(false)
    })

    test("Messages with warning in middle should still be excluded", () => {
      expect(detector.isCritical("Build completed with warning: Cannot find module")).toBe(false)
      expect(detector.isCritical("Compilation finished, warning: SyntaxError in legacy file")).toBe(false)
    })

    test("Empty and whitespace messages", () => {
      expect(detector.isCritical("")).toBe(false)
      expect(detector.isCritical("   ")).toBe(false)
      expect(detector.isCritical("\\n\\t  \\r")).toBe(false)
    })
  })
})
