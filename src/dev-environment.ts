import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, appendFileSync, mkdirSync, existsSync, copyFileSync, readFileSync, cpSync, lstatSync, symlinkSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import chalk from 'chalk';
import * as cliProgress from 'cli-progress';
import { CDPMonitor } from './cdp-monitor.js';

interface DevEnvironmentOptions {
  port: string;
  mcpPort: string;
  serverCommand: string;
  profileDir: string;
  logFile: string;
  debug?: boolean;
}

class Logger {
  private logFile: string;

  constructor(logFile: string) {
    this.logFile = logFile;
    // Ensure directory exists
    const logDir = dirname(logFile);
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    // Clear log file
    writeFileSync(this.logFile, '');
  }

  log(source: 'server' | 'browser', message: string) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${source.toUpperCase()}] ${message}\n`;
    appendFileSync(this.logFile, logEntry);
  }
}


function detectPackageManagerForRun(): string {
  if (existsSync('pnpm-lock.yaml')) return 'pnpm';
  if (existsSync('yarn.lock')) return 'yarn';
  if (existsSync('package-lock.json')) return 'npm';
  return 'npm'; // fallback
}

export function createPersistentLogFile(): string {
  // Create /var/log/dev3000 directory
  const logBaseDir = '/var/log/dev3000';
  try {
    if (!existsSync(logBaseDir)) {
      mkdirSync(logBaseDir, { recursive: true });
    }
  } catch (error) {
    // Fallback to user's temp directory if /var/log is not writable
    const fallbackDir = join(tmpdir(), 'dev3000-logs');
    if (!existsSync(fallbackDir)) {
      mkdirSync(fallbackDir, { recursive: true });
    }
    return createLogFileInDir(fallbackDir);
  }
  
  return createLogFileInDir(logBaseDir);
}

function createLogFileInDir(baseDir: string): string {
  // Get current working directory name
  const cwdName = basename(process.cwd()).replace(/[^a-zA-Z0-9-_]/g, '_');
  
  // Create timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  // Create log file path
  const logFileName = `dev3000-${cwdName}-${timestamp}.log`;
  const logFilePath = join(baseDir, logFileName);
  
  // Prune old logs for this project (keep only 10 most recent)
  pruneOldLogs(baseDir, cwdName);
  
  // Create the log file
  writeFileSync(logFilePath, '');
  
  // Create or update symlink to /tmp/dev3000.log
  const symlinkPath = '/tmp/dev3000.log';
  try {
    if (existsSync(symlinkPath)) {
      unlinkSync(symlinkPath);
    }
    symlinkSync(logFilePath, symlinkPath);
  } catch (error) {
    console.warn(chalk.yellow(`⚠️ Could not create symlink ${symlinkPath}: ${error}`));
  }
  
  return logFilePath;
}

function pruneOldLogs(baseDir: string, cwdName: string): void {
  try {
    // Find all log files for this project
    const files = readdirSync(baseDir)
      .filter(file => file.startsWith(`dev3000-${cwdName}-`) && file.endsWith('.log'))
      .map(file => ({
        name: file,
        path: join(baseDir, file),
        mtime: statSync(join(baseDir, file)).mtime
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime()); // Most recent first
    
    // Keep only the 10 most recent, delete the rest
    if (files.length >= 10) {
      const filesToDelete = files.slice(9); // Keep first 9, delete the rest
      for (const file of filesToDelete) {
        try {
          unlinkSync(file.path);
        } catch (error) {
          // Silently ignore deletion errors
        }
      }
    }
  } catch (error) {
    console.warn(chalk.yellow(`⚠️ Could not prune logs: ${error}`));
  }
}

export class DevEnvironment {
  private serverProcess: ChildProcess | null = null;
  private mcpServerProcess: ChildProcess | null = null;
  private cdpMonitor: CDPMonitor | null = null;
  private logger: Logger;
  private options: DevEnvironmentOptions;
  private screenshotDir: string;
  private mcpPublicDir: string;
  private pidFile: string;
  private progressBar: cliProgress.SingleBar;
  private version: string;

  constructor(options: DevEnvironmentOptions) {
    this.options = options;
    this.logger = new Logger(options.logFile);
    
    // Set up MCP server public directory for web-accessible screenshots
    const currentFile = fileURLToPath(import.meta.url);
    const packageRoot = dirname(dirname(currentFile));
    
    // Always use MCP server's public directory for screenshots to ensure they're web-accessible
    // and avoid permission issues with /var/log paths
    this.screenshotDir = join(packageRoot, 'mcp-server', 'public', 'screenshots');
    this.pidFile = join(tmpdir(), 'dev3000.pid');
    this.mcpPublicDir = join(packageRoot, 'mcp-server', 'public', 'screenshots');
    
    // Read version from package.json for startup message
    this.version = '0.0.0';
    try {
      const packageJsonPath = join(packageRoot, 'package.json');
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      this.version = packageJson.version;
      
      // Use git to detect if we're in the dev3000 source repository
      try {
        const { execSync } = require('child_process');
        const gitRemote = execSync('git remote get-url origin 2>/dev/null', { 
          cwd: packageRoot, 
          encoding: 'utf8' 
        }).trim();
        
        if (gitRemote.includes('vercel-labs/dev3000') && !this.version.includes('canary')) {
          this.version += '-local';
        }
      } catch {
        // Not in git repo or no git - use version as-is
      }
    } catch (error) {
      // Use fallback version
    }
    
    // Initialize progress bar
    this.progressBar = new cliProgress.SingleBar({
      format: '|' + chalk.cyan('{bar}') + '| {percentage}% | {stage}',
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true,
      barsize: 40
    }, cliProgress.Presets.shades_classic);
    
    // Ensure directories exist
    if (!existsSync(this.screenshotDir)) {
      mkdirSync(this.screenshotDir, { recursive: true });
    }
    if (!existsSync(this.mcpPublicDir)) {
      mkdirSync(this.mcpPublicDir, { recursive: true });
    }
  }


  private async checkPortsAvailable() {
    const ports = [this.options.port, this.options.mcpPort];
    
    for (const port of ports) {
      try {
        const result = await new Promise<string>((resolve) => {
          const proc = spawn('lsof', ['-ti', `:${port}`], { stdio: 'pipe' });
          let output = '';
          proc.stdout?.on('data', (data) => output += data.toString());
          proc.on('exit', () => resolve(output.trim()));
        });
        
        if (result) {
          result.split('\n').filter(line => line.trim());
          
          console.log(chalk.red(`❌ Port ${port} is already in use`));
          console.log(chalk.yellow(`💡 To free up port ${port}, run: lsof -ti:${port} | xargs kill -9`));
          throw new Error(`Port ${port} is already in use. Please free the port and try again.`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('Port')) {
          throw error; // Re-throw our custom error
        }
        // Ignore other errors - port might just be free
      }
    }
  }

  async start() {
    
    // Show startup message first
    console.log(chalk.blue(`Starting dev3000 (v${this.version})`));
    
    // Start progress bar
    this.progressBar.start(100, 0, { stage: 'Checking ports...' });
    
    // Check if ports are available first
    await this.checkPortsAvailable();
    this.progressBar.update(10, { stage: 'Starting servers...' });
    
    // Write our process group ID to PID file for cleanup
    writeFileSync(this.pidFile, process.pid.toString());
    
    // Setup cleanup handlers
    this.setupCleanupHandlers();
    
    // Start user's dev server
    await this.startServer();
    this.progressBar.update(20, { stage: 'Starting MCP server...' });
    
    // Start MCP server
    await this.startMcpServer();
    this.progressBar.update(30, { stage: 'Waiting for your app server...' });
    
    // Wait for servers to be ready (no artificial delays)
    await this.waitForServer();
    this.progressBar.update(60, { stage: 'Waiting for MCP server...' });
    
    await this.waitForMcpServer();
    this.progressBar.update(80, { stage: 'Starting browser...' });
    
    // Start CDP monitoring but don't wait for full setup
    this.startCDPMonitoringAsync();
    
    this.progressBar.update(100, { stage: 'Complete!' });
    
    // Stop progress bar and show results immediately
    this.progressBar.stop();
    
    console.log(chalk.green('\n✅ Development environment ready!'));
    console.log(chalk.blue(`Logs: ${this.options.logFile}`));
    console.log(chalk.blue(`Logs symlink: /tmp/dev3000.log`));
    console.log(chalk.yellow('☝️ Give this to an AI to auto debug and fix your app\n'));
    console.log(chalk.blue(`🌐 Your App: http://localhost:${this.options.port}`));
    console.log(chalk.blue(`🤖 MCP Server: http://localhost:${this.options.mcpPort}/api/mcp/mcp`));
    console.log(chalk.magenta(`📸 Visual Timeline: http://localhost:${this.options.mcpPort}/logs`));
    console.log(chalk.gray('\n💡 To stop all servers and kill dev3000: Ctrl-C'));
  }

  private async startServer() {
    const [command, ...args] = this.options.serverCommand.split(' ');
    
    this.serverProcess = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      detached: true, // Run independently
    });

    // Log server output (to file only, reduce stdout noise)
    this.serverProcess.stdout?.on('data', (data) => {
      const message = data.toString().trim();
      if (message) {
        this.logger.log('server', message);
      }
    });

    this.serverProcess.stderr?.on('data', (data) => {
      const message = data.toString().trim();
      if (message) {
        this.logger.log('server', `ERROR: ${message}`);
        // Suppress build errors and common dev errors from console output
        // They're still logged to file for debugging
        // Only show truly critical errors that would prevent startup
        const isCriticalError = message.includes('EADDRINUSE') || 
                               message.includes('EACCES') || 
                               message.includes('ENOENT') ||
                               (message.includes('FATAL') && !message.includes('generateStaticParams')) ||
                               (message.includes('Cannot find module') && !message.includes('.next'));
        
        if (isCriticalError) {
          console.error(chalk.red('[CRITICAL ERROR]'), message);
        }
      }
    });

    this.serverProcess.on('exit', (code) => {
      console.log(chalk.red(`Server process exited with code ${code}`));
    });
  }

  private debugLog(message: string) {
    if (this.options.debug) {
      console.log(`[MCP DEBUG] ${message}`);
    }
  }

  private async startMcpServer() {
    this.debugLog('Starting MCP server setup');
    // Get the path to our bundled MCP server
    const currentFile = fileURLToPath(import.meta.url);
    const packageRoot = dirname(dirname(currentFile)); // Go up from dist/ to package root
    const mcpServerPath = join(packageRoot, 'mcp-server');
    this.debugLog(`MCP server path: ${mcpServerPath}`);
    
    if (!existsSync(mcpServerPath)) {
      throw new Error(`MCP server directory not found at ${mcpServerPath}`);
    }
    this.debugLog('MCP server directory found');
    
    // Check if MCP server dependencies are installed, install if missing
    const isGlobalInstall = mcpServerPath.includes('.pnpm');
    this.debugLog(`Is global install: ${isGlobalInstall}`);
    let nodeModulesPath = join(mcpServerPath, 'node_modules');
    let actualWorkingDir = mcpServerPath;
    this.debugLog(`Node modules path: ${nodeModulesPath}`);
    
    if (isGlobalInstall) {
      const tmpDirPath = join(tmpdir(), 'dev3000-mcp-deps');
      nodeModulesPath = join(tmpDirPath, 'node_modules');
      actualWorkingDir = tmpDirPath;
      
      // Update screenshot directory to use the temp directory for global installs
      this.screenshotDir = join(actualWorkingDir, 'public', 'screenshots');
      if (!existsSync(this.screenshotDir)) {
        mkdirSync(this.screenshotDir, { recursive: true });
      }
    }
    
    // Always install dependencies to ensure they're up to date
    this.debugLog('Installing/updating MCP server dependencies');
    this.progressBar.stop();
    console.log(chalk.blue('\n📦 Installing MCP server dependencies...'));
    await this.installMcpServerDeps(mcpServerPath);
    console.log(''); // Add spacing
    this.progressBar.start(100, 20, { stage: 'Starting MCP server...' });
    
    // Use version already read in constructor

    // For global installs, ensure all necessary files are copied to temp directory
    if (isGlobalInstall && actualWorkingDir !== mcpServerPath) {
      const requiredFiles = ['app', 'public', 'next.config.ts', 'next-env.d.ts', 'tsconfig.json'];
      for (const file of requiredFiles) {
        const srcPath = join(mcpServerPath, file);
        const destPath = join(actualWorkingDir, file);
        
        // Check if we need to copy (source exists and destination doesn't exist or source is newer)
        if (existsSync(srcPath)) {
          let shouldCopy = !existsSync(destPath);
          
          // If destination exists, check if source is newer
          if (!shouldCopy && existsSync(destPath)) {
            const srcStat = lstatSync(srcPath);
            const destStat = lstatSync(destPath);
            shouldCopy = srcStat.mtime > destStat.mtime;
          }
          
          if (shouldCopy) {
            // Remove existing destination if it exists
            if (existsSync(destPath)) {
              if (lstatSync(destPath).isDirectory()) {
                cpSync(destPath, destPath + '.bak', { recursive: true });
                cpSync(srcPath, destPath, { recursive: true, force: true });
              } else {
                unlinkSync(destPath);
                copyFileSync(srcPath, destPath);
              }
            } else {
              if (lstatSync(srcPath).isDirectory()) {
                cpSync(srcPath, destPath, { recursive: true });
              } else {
                copyFileSync(srcPath, destPath);
              }
            }
          }
        }
      }
    }

    // Start the MCP server using detected package manager
    const packageManagerForRun = detectPackageManagerForRun();
    this.debugLog(`Using package manager: ${packageManagerForRun}`);
    this.debugLog(`MCP server working directory: ${actualWorkingDir}`);
    this.debugLog(`MCP server port: ${this.options.mcpPort}`);
    
    this.mcpServerProcess = spawn(packageManagerForRun, ['run', 'dev'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      detached: true, // Run independently
      cwd: actualWorkingDir,
      env: {
        ...process.env,
        PORT: this.options.mcpPort,
        LOG_FILE_PATH: this.options.logFile, // Pass log file path to MCP server
        DEV3000_VERSION: this.version, // Pass version to MCP server
      },
    });
    
    this.debugLog('MCP server process spawned');

    // Log MCP server output to separate file for debugging
    const mcpLogFile = join(dirname(this.options.logFile), 'dev3000-mcp.log');
    writeFileSync(mcpLogFile, ''); // Clear the file
    
    this.mcpServerProcess.stdout?.on('data', (data) => {
      const message = data.toString().trim();
      if (message) {
        const timestamp = new Date().toISOString();
        appendFileSync(mcpLogFile, `[${timestamp}] [MCP-STDOUT] ${message}\n`);
      }
    });
    
    this.mcpServerProcess.stderr?.on('data', (data) => {
      const message = data.toString().trim();
      if (message) {
        const timestamp = new Date().toISOString();
        appendFileSync(mcpLogFile, `[${timestamp}] [MCP-STDERR] ${message}\n`);
        // Only show critical errors in stdout for debugging
        if (message.includes('FATAL') || message.includes('Error:')) {
          console.error(chalk.red('[LOG VIEWER ERROR]'), message);
        }
      }
    });

    this.mcpServerProcess.on('exit', (code) => {
      this.debugLog(`MCP server process exited with code ${code}`);
      // Only show exit messages for unexpected failures, not restarts
      if (code !== 0 && code !== null) {
        this.logger.log('server', `MCP server process exited with code ${code}`);
      }
    });
    
    this.debugLog('MCP server event handlers setup complete');
  }


  private async waitForServer() {
    const maxAttempts = 30;
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      try {
        const response = await fetch(`http://localhost:${this.options.port}`, {
          method: 'HEAD',
          signal: AbortSignal.timeout(2000)
        });
        if (response.ok || response.status === 404) {
          return;
        }
      } catch (error) {
        // Server not ready yet, continue waiting
      }
      
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Continue anyway if health check fails
  }


  private async installMcpServerDeps(mcpServerPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // For global installs, we need to install to a writable location
      // Check if this is a global install by looking for .pnpm in the path
      const isGlobalInstall = mcpServerPath.includes('.pnpm');
      
      let workingDir = mcpServerPath;
      if (isGlobalInstall) {
        // Create a writable copy in temp directory for global installs
        const tmpDirPath = join(tmpdir(), 'dev3000-mcp-deps');
        
        // Ensure tmp directory exists
        if (!existsSync(tmpDirPath)) {
          mkdirSync(tmpDirPath, { recursive: true });
        }
        
        // Copy package.json to temp directory if it doesn't exist
        const tmpPackageJson = join(tmpDirPath, 'package.json');
        if (!existsSync(tmpPackageJson)) {
          const sourcePackageJson = join(mcpServerPath, 'package.json');
          copyFileSync(sourcePackageJson, tmpPackageJson);
        }
        
        workingDir = tmpDirPath;
      }
      
      const packageManager = detectPackageManagerForRun();
      
      // Show spinner instead of verbose output
      const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      let frameIndex = 0;
      const spinnerInterval = setInterval(() => {
        process.stdout.write(`\r${chalk.blue(frames[frameIndex])} Installing dependencies...`);
        frameIndex = (frameIndex + 1) % frames.length;
      }, 100);
      
      const installProcess = spawn(packageManager, ['install'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        cwd: workingDir,
      });

      // Add timeout (3 minutes)
      const timeout = setTimeout(() => {
        clearInterval(spinnerInterval);
        process.stdout.write('\r');
        installProcess.kill('SIGKILL');
        reject(new Error('MCP server dependency installation timed out after 3 minutes'));
      }, 3 * 60 * 1000);

      let hasOutput = false;

      // Suppress most output for cleaner experience
      installProcess.stdout?.on('data', (data) => {
        hasOutput = true;
        // Only show critical messages
        const message = data.toString().trim();
        if (message.includes('Done in')) {
          clearInterval(spinnerInterval);
          process.stdout.write(`\r${chalk.green('✅')} Dependencies installed successfully\n`);
        }
      });

      installProcess.stderr?.on('data', (data) => {
        hasOutput = true;
        // Suppress warnings and progress messages
      });

      installProcess.on('exit', (code) => {
        clearInterval(spinnerInterval);
        process.stdout.write('\r');
        clearTimeout(timeout);
        
        if (code === 0) {
          if (!hasOutput || !process.stdout.isTTY) {
            console.log(chalk.green('✅ MCP server dependencies installed successfully!'));
          }
          resolve();
        } else {
          console.log(chalk.red('❌ MCP server dependency installation failed'));
          reject(new Error(`MCP server dependency installation failed with exit code ${code}`));
        }
      });

      installProcess.on('error', (error) => {
        clearInterval(spinnerInterval);
        process.stdout.write('\r');
        clearTimeout(timeout);
        reject(new Error(`Failed to start MCP server dependency installation: ${error.message}`));
      });

      // Show helpful message after 5 seconds
      setTimeout(() => {
        if (!hasOutput) {
          clearInterval(spinnerInterval);
          process.stdout.write(`\r${chalk.yellow('⏳')} This may take a minute on first run...\n`);
          // Restart spinner on next line
          setInterval(() => {
            process.stdout.write(`\r${chalk.blue(frames[frameIndex])} Installing dependencies...`);
            frameIndex = (frameIndex + 1) % frames.length;
          }, 100);
        }
      }, 5000);
    });
  }

  private async waitForMcpServer() {
    const maxAttempts = 30;
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      try {
        // Test the actual MCP endpoint
        const response = await fetch(`http://localhost:${this.options.mcpPort}`, {
          method: 'HEAD',
          signal: AbortSignal.timeout(2000)
        });
        this.debugLog(`MCP server health check: ${response.status}`);
        if (response.status === 500) {
          const errorText = await response.text();
          this.debugLog(`MCP server 500 error: ${errorText}`);
        }
        if (response.ok || response.status === 404) { // 404 is OK - means server is responding
          return;
        }
      } catch (error) {
        this.debugLog(`MCP server not ready (attempt ${attempts}): ${error}`);
      }
      
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    this.debugLog('MCP server health check failed, terminating');
    throw new Error(`MCP server failed to start after ${maxAttempts} seconds. Check the logs for errors.`);
  }

  private startCDPMonitoringAsync() {
    // Start CDP monitoring in background without blocking completion
    this.startCDPMonitoring().catch(error => {
      console.error(chalk.red('⚠️ CDP monitoring setup failed:'), error);
    });
  }

  private async startCDPMonitoring() {
    // Ensure profile directory exists
    if (!existsSync(this.options.profileDir)) {
      mkdirSync(this.options.profileDir, { recursive: true });
    }
    
    // Initialize CDP monitor with enhanced logging
    this.cdpMonitor = new CDPMonitor(this.options.profileDir, (source: string, message: string) => {
      this.logger.log('browser', message);
    }, this.options.debug);
    
    try {
      // Start CDP monitoring
      await this.cdpMonitor.start();
      this.logger.log('browser', '[CDP] Chrome launched with DevTools Protocol monitoring');
      
      // Navigate to the app
      await this.cdpMonitor.navigateToApp(this.options.port);
      this.logger.log('browser', `[CDP] Navigated to http://localhost:${this.options.port}`);
      
    } catch (error) {
      // Log error but don't crash - we want the servers to keep running
      this.logger.log('browser', `[CDP ERROR] Failed to start CDP monitoring: ${error}`);
      console.error(chalk.red('⚠️ CDP monitoring failed, but servers are still running'));
    }
  }


  private setupCleanupHandlers() {
    // Handle Ctrl+C to kill all processes
    process.on('SIGINT', async () => {
      console.log(chalk.yellow('\n🛑 Received interrupt signal. Cleaning up processes...'));
      
      // Kill processes on both ports FIRST - this is most important
      const killPortProcess = async (port: string, name: string) => {
        try {
          const { spawn } = await import('child_process');
          const killProcess = spawn('sh', ['-c', `lsof -ti:${port} | xargs kill -9`], { stdio: 'inherit' });
          return new Promise<void>((resolve) => {
            killProcess.on('exit', (code) => {
              if (code === 0) {
                console.log(chalk.green(`✅ Killed ${name} on port ${port}`));
              }
              resolve();
            });
          });
        } catch (error) {
          console.log(chalk.gray(`⚠️ Could not kill ${name} on port ${port}`));
        }
      };
      
      // Kill servers immediately - don't wait for browser cleanup
      console.log(chalk.blue('🔄 Killing servers...'));
      await Promise.all([
        killPortProcess(this.options.port, 'your app server'),
        killPortProcess(this.options.mcpPort, 'dev3000 MCP server')
      ]);
      
      // Shutdown CDP monitor
      if (this.cdpMonitor) {
        try {
          console.log(chalk.blue('🔄 Closing CDP monitor...'));
          await this.cdpMonitor.shutdown();
          console.log(chalk.green('✅ CDP monitor closed'));
        } catch (error) {
          console.log(chalk.gray('⚠️ CDP monitor shutdown failed'));
        }
      }
      
      console.log(chalk.green('✅ Cleanup complete'));
      process.exit(0);
    });
  }
}

export async function startDevEnvironment(options: DevEnvironmentOptions) {
  const devEnv = new DevEnvironment(options);
  await devEnv.start();
}