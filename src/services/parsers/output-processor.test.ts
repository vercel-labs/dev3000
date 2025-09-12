/**
 * Tests for the modular log parsing system with Next.js support
 */

import { describe, it, expect } from 'vitest';
import { OutputProcessor } from './output-processor.js';
import { StandardLogParser } from './log-parsers/standard.js';
import { NextJsErrorDetector } from './error-detectors/nextjs.js';

describe('OutputProcessor with Next.js Log Detection', () => {
  const processor = new OutputProcessor(
    new StandardLogParser(),
    new NextJsErrorDetector()
  );

  it('should process standard output without errors', () => {
    const result = processor.process('Ready - started server on 0.0.0.0:3000', false);

    expect(result).toHaveLength(1);
    expect(result[0].formatted).toBe('Ready - started server on 0.0.0.0:3000');
    expect(result[0].isCritical).toBeUndefined();
  });

  it('should detect Next.js compilation failures as critical', () => {
    const result = processor.process('Failed to compile', true);

    expect(result).toHaveLength(1);
    expect(result[0].formatted).toBe('ERROR: Failed to compile');
    expect(result[0].isCritical).toBe(true);
    expect(result[0].rawMessage).toBe('Failed to compile');
  });

  it('should detect module resolution errors as critical', () => {
    const result = processor.process('Module not found: Can\'t resolve \'./missing-file\'', true);

    expect(result).toHaveLength(1);
    expect(result[0].isCritical).toBe(true);
    expect(result[0].rawMessage).toBe('Module not found: Can\'t resolve \'./missing-file\'');
  });

  it('should detect TypeScript compilation errors as critical', () => {
    const result = processor.process('TSError: TypeScript error in components/Button.tsx', true);

    expect(result).toHaveLength(1);
    expect(result[0].isCritical).toBe(true);
    expect(result[0].rawMessage).toBe('TSError: TypeScript error in components/Button.tsx');
  });

  it('should not mark Next.js warnings and non-critical errors as critical', () => {
    // Test webpack warnings
    const webpackResult = processor.process('webpack compiled with 1 warning', true);
    expect(webpackResult[0].isCritical).toBeUndefined();

    // Test runtime errors (don't stop dev server)
    const runtimeResult = processor.process('Unhandled Runtime Error', true);
    expect(runtimeResult[0].isCritical).toBeUndefined();

    // Test development messages
    const devResult = processor.process('ready - started server on 0.0.0.0:3000', true);
    expect(devResult[0].isCritical).toBeUndefined();

    // Test Fast Refresh
    const refreshResult = processor.process('Fast Refresh had to perform a full reload', true);
    expect(refreshResult[0].isCritical).toBeUndefined();
  });

  it('should handle multiple lines of output', () => {
    const result = processor.process('Line 1\nLine 2\nLine 3', false);

    expect(result).toHaveLength(3);
    expect(result[0].formatted).toBe('Line 1');
    expect(result[1].formatted).toBe('Line 2');
    expect(result[2].formatted).toBe('Line 3');
  });

  it('should handle empty input', () => {
    const result = processor.process('', false);

    expect(result).toHaveLength(0);
  });
});