/**
 * Next.js error detector for Next.js applications
 * Extends base detector with Next.js-specific error patterns
 */

import { BaseErrorDetector } from './base.js';

export class NextJsErrorDetector extends BaseErrorDetector {
  isCritical(message: string): boolean {
    // Next.js-specific exclusions that must be handled BEFORE calling super
    // These patterns would normally be flagged as critical by the base detector
    const exclusionPatterns = [
      /FATAL.*generateStaticParams|generateStaticParams.*FATAL/,  // FATAL errors during static generation (either order)
      /Cannot find module.*\.next|Module not found.*\.next/,       // Missing .next build artifacts (both error formats)
    ];

    if (exclusionPatterns.some(pattern => pattern.test(message))) {
      return false;
    }

    // Check base class for framework-agnostic critical errors
    if (super.isCritical(message)) {
      return true;
    }

    // Next.js-specific critical errors that prevent development/building
    const criticalPatterns = [
      // Build/compilation failures that stop the dev server
      /Failed to compile/,                     // Compilation failures (most critical)
      /webpack.*compilation.*failed/i,         // Webpack compilation failures
      /Build optimization failed/,             // Build failures

      // Missing dependencies/modules that prevent compilation
      /Module not found.*Can't resolve/,       // Missing module imports
      /Cannot resolve dependency/,             // Dependency resolution failures

      // Configuration errors that prevent startup
      /Invalid configuration/,                 // Next.js config errors
      /Configuration error/,                   // Config parsing errors

      // Build directory issues
      /Error: ENOENT.*\.next/,                 // Missing .next directory (build artifacts)
      /Failed to read.*\.next/,                // Can't read build artifacts

      // Memory/resource issues during build
      /JavaScript heap out of memory/,         // Out of memory during build
      /Process out of memory/,                 // Process memory exhaustion

      // SSG/SSR build-time errors (prevent build completion)
      /Error occurred prerendering page.*build/i,  // Build-time prerender failures
      /getStaticPaths.*error.*build/i,             // Build-time getStaticPaths errors
      /getStaticProps.*error.*build/i,             // Build-time getStaticProps errors

      // Syntax errors that prevent compilation
      /SyntaxError.*Unexpected token/,         // JS/TS syntax errors
      /TSError.*TypeScript error/,             // TypeScript compilation errors
      /ESLint.*Parsing error/,                 // ESLint parsing failures
    ];

    // Check for critical patterns
    return criticalPatterns.some(pattern => pattern.test(message));
  }
}
