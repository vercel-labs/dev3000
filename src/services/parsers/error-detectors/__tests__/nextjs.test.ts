/**
 * Tests for NextJsErrorDetector with real-world Next.js error messages from production
 */

import { describe, expect, test } from "vitest"
import { NextJsErrorDetector } from "../nextjs.js"

describe("NextJsErrorDetector", () => {
  const detector = new NextJsErrorDetector()

  describe("Next.js-Specific Exclusions - Should Return False", () => {
    test("FATAL errors during generateStaticParams should be excluded", () => {
      // Real production messages from Next.js static generation
      expect(detector.isCritical("FATAL: Error in generateStaticParams for /blog/[slug]")).toBe(false)
      expect(detector.isCritical("FATAL ERROR during generateStaticParams: Invalid slug format")).toBe(false)
      expect(detector.isCritical("generateStaticParams FATAL: Database connection failed")).toBe(false)
    })

    test(".next build artifact errors should be excluded", () => {
      // Real production errors when .next directory is missing/corrupted
      expect(detector.isCritical("Cannot find module '.next/server/app/page.js'")).toBe(false)
      expect(detector.isCritical("Error: Cannot find module '.next/static/chunks/pages/_app.js'")).toBe(false)
      expect(detector.isCritical("Module not found: Can't resolve '.next/server/pages-manifest.json'")).toBe(false)
    })
  })

  describe("Next.js Critical Errors - Should Return True", () => {
    test("Build and compilation failures", () => {
      // Real compilation error from production deployments
      expect(detector.isCritical("Failed to compile.")).toBe(true)
      expect(
        detector.isCritical(`Failed to compile. 
        ./components/ParentComponent.js
        Module not found: Can't resolve './Component'`)
      ).toBe(true)
      expect(detector.isCritical("webpack compilation failed with 1 error")).toBe(true)
      expect(detector.isCritical("Build optimization failed: unable to optimize page")).toBe(true)
    })

    test("Module resolution failures", () => {
      // Real error messages from Next.js deployments
      expect(detector.isCritical("Module not found: Can't resolve 'tailwindcss'")).toBe(true)
      expect(detector.isCritical("Module not found: Can't resolve './components/MyComponent'")).toBe(true)
      expect(detector.isCritical("Cannot resolve dependency '@/lib/utils'")).toBe(true)
    })

    test("Configuration errors", () => {
      expect(detector.isCritical("Invalid configuration: next.config.js syntax error")).toBe(true)
      expect(detector.isCritical("Configuration error: Invalid webpack config")).toBe(true)
    })

    test("Build directory issues", () => {
      // These are different from .next module imports - these are about missing build directory itself
      expect(detector.isCritical("Error: ENOENT: no such file or directory, scandir '.next'")).toBe(true)
      expect(detector.isCritical("Failed to read .next/build-manifest.json")).toBe(true)
    })

    test("Memory issues during build", () => {
      // Real production build failures
      expect(detector.isCritical("JavaScript heap out of memory during build")).toBe(true)
      expect(detector.isCritical("Process out of memory while compiling pages")).toBe(true)
    })

    test("SSG/SSR build-time errors", () => {
      expect(detector.isCritical('Error occurred prerendering page "/blog/post-1" during build')).toBe(true)
      expect(detector.isCritical("getStaticPaths error during build: Invalid paths returned")).toBe(true)
      expect(detector.isCritical("getStaticProps error during build: Database connection failed")).toBe(true)
    })

    test("TypeScript and syntax errors", () => {
      // Real TypeScript compilation errors from Next.js builds
      expect(detector.isCritical("SyntaxError: Unexpected token '}' in /pages/index.js")).toBe(true)
      expect(detector.isCritical("TSError: TypeScript error in components/Button.tsx")).toBe(true)
      expect(detector.isCritical("ESLint parsing error: Unexpected token")).toBe(true)
    })
  })

  describe("Inherited Base Detector Functionality", () => {
    test("Should still catch base critical errors", () => {
      // These come from the base detector
      expect(detector.isCritical("Error: listen EADDRINUSE: address already in use :::3000")).toBe(true)
      expect(detector.isCritical("ENOENT: no such file or directory, open 'package.json'")).toBe(true)
      expect(detector.isCritical("FATAL ERROR: JavaScript heap out of memory")).toBe(true)
    })

    test("Should exclude warnings from base patterns", () => {
      expect(detector.isCritical("warning: Cannot find module 'optional-peer-dep'")).toBe(false)
      expect(detector.isCritical("WARN: Deprecated configuration detected")).toBe(false)
    })

    test("Should handle regular FATAL errors (not generateStaticParams)", () => {
      // These should be flagged as critical since they don't involve generateStaticParams
      expect(detector.isCritical("FATAL: Database connection refused")).toBe(true)
      expect(detector.isCritical("FATAL ERROR: Server startup failed")).toBe(true)
    })

    test("Should handle regular Cannot find module errors (not .next)", () => {
      // These should be flagged as critical since they don't involve .next
      expect(detector.isCritical("Cannot find module 'react'")).toBe(true)
      expect(detector.isCritical("Cannot find module '@/components/Button'")).toBe(true)
    })
  })

  describe("Real Production Scenarios", () => {
    test("TailwindCSS deployment failure (2024)", () => {
      const error = `Failed to compile.
        Error: Cannot find module 'tailwindcss'
        Require stack:
        - /projects/myapp/node_modules/next/dist/build/webpack/config/blocks/css/plugins.js`
      expect(detector.isCritical(error)).toBe(true)
    })

    test("Component import failure", () => {
      const error = `Failed to compile.
        ./components/ParentComponent.js
        Module not found: Can't resolve './Component' in '/workspace/components'`
      expect(detector.isCritical(error)).toBe(true)
    })

    test("TypeScript module resolution", () => {
      const error = `Type error: Cannot find module 'next/app' or its corresponding type declarations.
        1 | import '@/styles/globals.css'
        > 2 | import type {AppProps} from 'next/app'`
      expect(detector.isCritical(error)).toBe(true)
    })

    test("Build artifact corruption (should be excluded)", () => {
      const error = `Cannot find module '../.next/server/app/layout.js' 
        This typically happens after a failed build or when .next directory is corrupted`
      expect(detector.isCritical(error)).toBe(false)
    })
  })
})
