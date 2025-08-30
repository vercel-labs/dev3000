#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { startDevEnvironment } from './dev-environment.js';
import { setupProject } from './setup.js';

const program = new Command();

program
  .name('nextjs-ai-dev')
  .description('AI-powered development tools for Next.js with browser monitoring and MCP server')
  .version('1.0.0');

program
  .command('start')
  .description('Start development environment with browser monitoring and MCP server')
  .option('-p, --port <port>', 'Development server port', '3000')
  .option('--server-command <command>', 'Custom server start command', 'pnpm dev')
  .option('--profile-dir <dir>', 'Chrome profile directory', './ai-dev-tools/chrome-profile')
  .option('--log-file <file>', 'Consolidated log file path', './ai-dev-tools/consolidated.log')
  .action(async (options) => {
    console.log(chalk.blue.bold('🤖 Starting Next.js AI Development Environment'));
    
    try {
      await startDevEnvironment(options);
    } catch (error) {
      console.error(chalk.red('❌ Failed to start development environment:'), error);
      process.exit(1);
    }
  });

program
  .command('setup')
  .description('Setup MCP server routes in your Next.js project')
  .option('--force', 'Overwrite existing files')
  .action(async (options) => {
    console.log(chalk.blue.bold('🛠️  Setting up MCP server routes'));
    
    try {
      await setupProject(options);
      console.log(chalk.green('✅ Project setup complete!'));
    } catch (error) {
      console.error(chalk.red('❌ Setup failed:'), error);
      process.exit(1);
    }
  });

// Default command - if no subcommand is provided, run start
if (process.argv.length === 2) {
  process.argv.push('start');
}

program.parse();