#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import { startDevEnvironment } from './dev-environment.js';

function detectPackageManager(): string {
  if (existsSync('pnpm-lock.yaml')) return 'pnpm';
  if (existsSync('yarn.lock')) return 'yarn';
  if (existsSync('package-lock.json')) return 'npm';
  return 'npm'; // fallback
}

const program = new Command();

program
  .name('dev-playwright')
  .description('AI-powered development tools with browser monitoring and MCP server')
  .version('0.0.1');

program
  .description('AI-powered development tools with browser monitoring and MCP server')
  .option('-p, --port <port>', 'Development server port', '3000')
  .option('--mcp-port <port>', 'MCP server port', '3684')
  .option('-s, --script <script>', 'Package.json script to run (e.g. dev, build-start)', 'dev')
  .option('--profile-dir <dir>', 'Chrome profile directory', join(tmpdir(), 'dev-playwright-chrome-profile'))
  .option('--log-file <file>', 'Consolidated log file path', join(tmpdir(), 'dev-playwright-consolidated.log'))
  .action(async (options) => {
    console.log(chalk.blue.bold('🤖 Starting AI Development Environment'));
    
    // Convert script option to full command
    const packageManager = detectPackageManager();
    const serverCommand = `${packageManager} run ${options.script}`;
    
    try {
      await startDevEnvironment({
        ...options,
        serverCommand
      });
    } catch (error) {
      console.error(chalk.red('❌ Failed to start development environment:'), error);
      process.exit(1);
    }
  });

program.parse();