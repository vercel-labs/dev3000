import { spawn, ChildProcess } from 'child_process';
import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { writeFileSync, appendFileSync, mkdirSync, existsSync, copyFileSync, readFileSync, cpSync, lstatSync, symlinkSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import chalk from 'chalk';
import * as cliProgress from 'cli-progress';

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

function detectPackageManager(): string {
  if (existsSync('pnpm-lock.yaml')) return 'pnpx';
  if (existsSync('yarn.lock')) return 'yarn dlx';
  if (existsSync('package-lock.json')) return 'npx';
  return 'npx'; // fallback
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
          console.log(chalk.gray(`🗑️ Pruned old log: ${file.name}`));
        } catch (error) {
          console.warn(chalk.yellow(`⚠️ Could not delete old log ${file.name}: ${error}`));
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
  private browser: Browser | null = null;
  private browserContext: BrowserContext | null = null;
  private logger: Logger;
  private stateTimer: NodeJS.Timeout | null = null;
  private browserType: 'system-chrome' | 'playwright-chromium' | null = null;
  private options: DevEnvironmentOptions;
  private screenshotDir: string;
  private mcpPublicDir: string;
  private pidFile: string;
  private progressBar: cliProgress.SingleBar;

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
    
    // Initialize progress bar
    this.progressBar = new cliProgress.SingleBar({
      format: chalk.blue('Starting dev3000') + ' |' + chalk.cyan('{bar}') + '| {percentage}% | {stage}',
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

  private debugLog(message: string) {
    if (this.options.debug) {
      console.log(chalk.gray(`[DEBUG] ${message}`));
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
    
    // Animate progress while waiting for servers with realistic increments
    const serverWaitPromise = this.waitForServer();
    const progressAnimation = this.animateProgress(30, 50, serverWaitPromise, 'app server starting');
    await Promise.all([serverWaitPromise, progressAnimation]);
    
    this.progressBar.update(50, { stage: 'Waiting for MCP server...' });
    const mcpWaitPromise = this.waitForMcpServer();
    const mcpProgressAnimation = this.animateProgress(50, 70, mcpWaitPromise, 'MCP server starting');
    await Promise.all([mcpWaitPromise, mcpProgressAnimation]);
    
    this.progressBar.update(70, { stage: 'Starting browser...' });
    
    // Start browser monitoring
    const browserPromise = this.startBrowserMonitoring();
    const browserProgressAnimation = this.animateProgress(70, 100, browserPromise, 'browser starting');
    await Promise.all([browserPromise, browserProgressAnimation]);
    
    this.progressBar.update(100, { stage: 'Complete!' });
    
    // Stop progress bar and show results
    this.progressBar.stop();
    
    console.log(chalk.green('\n✅ Development environment ready!'));
    console.log(chalk.blue(`📊 Logs: ${this.options.logFile}`));
    console.log(chalk.gray(`🔧 MCP Server Logs: ${join(dirname(this.options.logFile), 'dev3000-mcp.log')}`));
    console.log(chalk.yellow('☝️ Give this to an AI to auto debug and fix your app\n'));
    console.log(chalk.blue(`🌐 Your App: http://localhost:${this.options.port}`));
    console.log(chalk.blue(`🤖 MCP Server: http://localhost:${this.options.mcpPort}/api/mcp/http`));
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

  private async startMcpServer() {
    // Get the path to our bundled MCP server
    const currentFile = fileURLToPath(import.meta.url);
    const packageRoot = dirname(dirname(currentFile)); // Go up from dist/ to package root
    const mcpServerPath = join(packageRoot, 'mcp-server');
    
    if (!existsSync(mcpServerPath)) {
      throw new Error(`MCP server directory not found at ${mcpServerPath}`);
    }
    
    // Check if MCP server dependencies are installed, install if missing
    const isGlobalInstall = mcpServerPath.includes('.pnpm');
    let nodeModulesPath = join(mcpServerPath, 'node_modules');
    let actualWorkingDir = mcpServerPath;
    
    if (isGlobalInstall) {
      const tmpDirPath = join(tmpdir(), 'dev3000-mcp-deps');
      nodeModulesPath = join(tmpDirPath, 'node_modules');
      actualWorkingDir = tmpDirPath;
    }
    
    if (!existsSync(nodeModulesPath)) {
      // Hide progress bar during installation
      this.progressBar.stop();
      console.log(chalk.blue('\n📦 Installing MCP server dependencies (first time only)...'));
      await this.installMcpServerDeps(mcpServerPath);
      console.log(''); // Add spacing
      // Resume progress bar
      this.progressBar.start(100, 20, { stage: 'Starting MCP server...' });
    }
    
    // Read version from package.json
    const versionCurrentFile = fileURLToPath(import.meta.url);
    const versionPackageRoot = dirname(dirname(versionCurrentFile));
    const packageJsonPath = join(versionPackageRoot, 'package.json');
    let version = '0.0.0';
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      version = packageJson.version;
      // Add -dev suffix for local development when running from symlinked source
      if (process.cwd().includes('vercel-labs/dev3000')) {
        version += '-dev';
      }
    } catch (error) {
      console.log(chalk.yellow('⚠️ Could not read version from package.json'));
    }

    // For global installs, ensure all necessary files are copied to temp directory
    if (isGlobalInstall && actualWorkingDir !== mcpServerPath) {
      const requiredFiles = ['app', 'public', 'next.config.ts', 'next-env.d.ts', 'tsconfig.json'];
      for (const file of requiredFiles) {
        const srcPath = join(mcpServerPath, file);
        const destPath = join(actualWorkingDir, file);
        if (existsSync(srcPath) && !existsSync(destPath)) {
          if (lstatSync(srcPath).isDirectory()) {
            cpSync(srcPath, destPath, { recursive: true });
          } else {
            copyFileSync(srcPath, destPath);
          }
        }
      }
    }

    // Start the MCP server using detected package manager
    const packageManagerForRun = detectPackageManagerForRun();
    this.mcpServerProcess = spawn(packageManagerForRun, ['run', 'dev'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      detached: true, // Run independently
      cwd: actualWorkingDir,
      env: {
        ...process.env,
        PORT: this.options.mcpPort,
        LOG_FILE_PATH: this.options.logFile, // Pass log file path to MCP server
        DEV3000_VERSION: version, // Pass version to MCP server
      },
    });

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
      // Only show exit messages for unexpected failures, not restarts
      if (code !== 0 && code !== null) {
        this.logger.log('server', `MCP server process exited with code ${code}`);
      }
    });
  }

  private startStateSaving() {
    if (this.stateTimer) {
      clearInterval(this.stateTimer);
    }
    
    // Start continuous autosave timer (no focus dependency since it's non-intrusive)
    this.stateTimer = setInterval(async () => {
      if (this.browserContext) {
        try {
          this.debugLog('Running periodic context autosave (non-intrusive)...');
          await this.saveStateManually();
          this.debugLog('Context autosave completed successfully');
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.debugLog(`Context autosave failed: ${errorMessage}`);
          // If context is closed, stop the timer
          if (errorMessage.includes('closed') || errorMessage.includes('destroyed')) {
            this.debugLog('Browser context appears closed, stopping autosave timer');
            this.stopStateSaving();
          }
        }
      }
    }, 15000); // Save every 15 seconds
  }
  
  private stopStateSaving() {
    if (this.stateTimer) {
      clearInterval(this.stateTimer);
      this.stateTimer = null;
    }
  }

  private async saveStateManually() {
    if (!this.browserContext) return;

    const stateDir = this.options.profileDir;
    const cookiesFile = join(stateDir, 'cookies.json');
    const storageFile = join(stateDir, 'storage.json');

    try {
      // Save cookies (non-intrusive)
      const cookies = await this.browserContext.cookies();
      writeFileSync(cookiesFile, JSON.stringify(cookies, null, 2));

      // Save localStorage and sessionStorage from current pages (non-intrusive)
      const pages = this.browserContext.pages();
      if (pages.length > 0) {
        const page = pages[0]; // Use first page to avoid creating new ones
        if (!page.isClosed()) {
          const storageData = await page.evaluate(() => {
            return {
              localStorage: JSON.stringify(localStorage),
              sessionStorage: JSON.stringify(sessionStorage),
              url: window.location.href
            };
          });
          writeFileSync(storageFile, JSON.stringify(storageData, null, 2));
        }
      }
    } catch (error) {
      // Re-throw to be handled by caller
      throw error;
    }
  }

  private async loadStateManually() {
    if (!this.browserContext) return;

    const stateDir = this.options.profileDir;
    const cookiesFile = join(stateDir, 'cookies.json');
    const storageFile = join(stateDir, 'storage.json');

    try {
      // Load cookies if they exist
      if (existsSync(cookiesFile)) {
        const cookies = JSON.parse(readFileSync(cookiesFile, 'utf8'));
        if (Array.isArray(cookies) && cookies.length > 0) {
          await this.browserContext.addCookies(cookies);
          this.debugLog(`Restored ${cookies.length} cookies`);
        }
      }

      // Load storage data for later restoration (we'll apply it after page navigation)
      if (existsSync(storageFile)) {
        const storageData = JSON.parse(readFileSync(storageFile, 'utf8'));
        if (storageData.localStorage || storageData.sessionStorage) {
          // Store this for restoration after page loads
          (this.browserContext as any)._dev3000_storageData = storageData;
          this.debugLog('Loaded storage data for restoration');
        }
      }
    } catch (error) {
      this.debugLog(`Failed to load saved state: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async restoreStorageData(page: Page) {
    if (!this.browserContext || page.isClosed()) return;

    const storageData = (this.browserContext as any)._dev3000_storageData;
    if (!storageData) return;

    try {
      await page.evaluate((data) => {
        // Restore localStorage
        if (data.localStorage) {
          const localStorageData = JSON.parse(data.localStorage);
          Object.keys(localStorageData).forEach(key => {
            localStorage.setItem(key, localStorageData[key]);
          });
        }

        // Restore sessionStorage
        if (data.sessionStorage) {
          const sessionStorageData = JSON.parse(data.sessionStorage);
          Object.keys(sessionStorageData).forEach(key => {
            sessionStorage.setItem(key, sessionStorageData[key]);
          });
        }
      }, storageData);

      this.debugLog('Restored localStorage and sessionStorage');
      
      // Clear the stored data since it's been applied
      delete (this.browserContext as any)._dev3000_storageData;
    } catch (error) {
      this.debugLog(`Failed to restore storage data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async setupFocusHandlers(page: Page) {
    // Note: Focus handlers removed since autosave is now continuous and non-intrusive
    // The autosave timer will detect context closure through its own error handling
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

  private async animateProgress(startPercent: number, endPercent: number, waitPromise: Promise<any>, stage: string) {
    const duration = 15000; // 15 seconds max animation
    const interval = 200; // Update every 200ms
    const totalSteps = duration / interval;
    
    let currentPercent = startPercent;
    let step = 0;
    
    const animationInterval = setInterval(() => {
      if (step < totalSteps) {
        // Use easing function for more realistic progress
        const progress = step / totalSteps;
        const easedProgress = 1 - Math.pow(1 - progress, 3); // Ease-out cubic
        currentPercent = startPercent + (endPercent - startPercent) * easedProgress;
        
        this.progressBar.update(Math.min(currentPercent, endPercent - 1), { 
          stage: `${stage}... ${Math.floor(currentPercent)}%` 
        });
        step++;
      }
    }, interval);
    
    try {
      await waitPromise;
    } finally {
      clearInterval(animationInterval);
    }
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
        const response = await fetch(`http://localhost:${this.options.mcpPort}`, {
          method: 'HEAD',
          signal: AbortSignal.timeout(2000)
        });
        if (response.ok || response.status === 404) {
          return;
        }
      } catch (error) {
        // MCP server not ready yet, continue waiting
      }
      
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Continue anyway if health check fails
  }

  private async startBrowserMonitoring() {
    // Ensure profile directory exists
    if (!existsSync(this.options.profileDir)) {
      mkdirSync(this.options.profileDir, { recursive: true });
    }
    
    try {
      // Try to use system Chrome first
      this.browser = await chromium.launch({
        headless: false,
        channel: 'chrome', // Use system Chrome
        // Remove automation flags to allow normal dialog behavior
        args: [
          '--disable-web-security', // Keep this for dev server access
          '--hide-crash-restore-bubble', // Don't ask to restore pages
          '--disable-infobars', // Remove info bars
          '--disable-blink-features=AutomationControlled', // Hide automation detection
          '--disable-features=VizDisplayCompositor', // Reduce automation fingerprinting
        ],
      });
      this.browserType = 'system-chrome';
    } catch (error: any) {
      // Fallback to Playwright's bundled chromium
      try {
        this.browser = await chromium.launch({
          headless: false,
          // Remove automation flags to allow normal dialog behavior
          args: [
            '--disable-web-security', // Keep this for dev server access
            '--hide-crash-restore-bubble', // Don't ask to restore pages
            '--disable-infobars', // Remove info bars
            '--disable-blink-features=AutomationControlled', // Hide automation detection
            '--disable-features=VizDisplayCompositor', // Reduce automation fingerprinting
          ],
        });
        this.browserType = 'playwright-chromium';
      } catch (playwrightError: any) {
        if (playwrightError.message?.includes('Executable doesn\'t exist')) {
          detectPackageManager();
          console.log(chalk.yellow('📦 Installing Playwright chromium browser...'));
          await this.installPlaywrightBrowsers();
          
          // Retry with bundled chromium
          this.browser = await chromium.launch({
            headless: false,
            // Remove automation flags to allow normal dialog behavior
            args: [
              '--disable-web-security', // Keep this for dev server access
              '--hide-crash-restore-bubble', // Don't ask to restore pages
              '--disable-infobars', // Remove info bars
            ],
          });
          this.browserType = 'playwright-chromium';
        } else {
          throw playwrightError;
        }
      }
    }
    
    // Create context with viewport: null to enable window resizing
    this.browserContext = await this.browser.newContext({
      viewport: null, // This makes the page size depend on the window size
    });

    // Restore state manually (non-intrusive)
    await this.loadStateManually();
    
    // Set up focus-aware periodic storage state saving
    this.startStateSaving();
    
    // Navigate to the app using the existing blank page
    const pages = this.browserContext.pages();
    const page = pages.length > 0 ? pages[0] : await this.browserContext.newPage();
    
    // Disable automatic dialog handling - let dialogs behave naturally
    page.removeAllListeners('dialog');
    
    // Add a no-op dialog handler to prevent auto-dismissal
    page.on('dialog', async (dialog) => {
      // Don't accept or dismiss - let user handle it manually
      // This prevents Playwright from auto-handling the dialog
    });
    
    await page.goto(`http://localhost:${this.options.port}`);
    
    // Restore localStorage and sessionStorage after navigation
    await this.restoreStorageData(page);
    
    // Set up focus detection after navigation to prevent context execution errors
    await this.setupFocusHandlers(page);
    
    // Take initial screenshot
    const initialScreenshot = await this.takeScreenshot(page, 'initial-load');
    if (initialScreenshot) {
      this.logger.log('browser', `[SCREENSHOT] ${initialScreenshot}`);
    }
    
    // Set up monitoring
    await this.setupPageMonitoring(page);
    
    // Monitor new pages
    this.browserContext.on('page', async (newPage) => {
      // Disable automatic dialog handling for new pages too
      newPage.removeAllListeners('dialog');
      
      // Add a no-op dialog handler to prevent auto-dismissal
      newPage.on('dialog', async (dialog) => {
        // Don't accept or dismiss - let user handle it manually
      });
      
      await this.setupPageMonitoring(newPage);
    });
  }

  private async installPlaywrightBrowsers(): Promise<void> {
    this.progressBar.update(75, { stage: 'Installing Playwright browser (2-3 min)...' });
    
    return new Promise<void>((resolve, reject) => {
      const packageManager = detectPackageManager();
      const [command, ...args] = packageManager.split(' ');
      
      console.log(chalk.gray(`Running: ${command} ${[...args, 'playwright', 'install', 'chromium'].join(' ')}`));
      
      const installProcess = spawn(command, [...args, 'playwright', 'install', 'chromium'], {
        stdio: ['inherit', 'pipe', 'pipe'],
        shell: true,
      });

      // Add timeout (5 minutes)
      const timeout = setTimeout(() => {
        installProcess.kill('SIGKILL');
        reject(new Error('Playwright installation timed out after 5 minutes'));
      }, 5 * 60 * 1000);

      let hasOutput = false;

      installProcess.stdout?.on('data', (data) => {
        hasOutput = true;
        const message = data.toString().trim();
        if (message) {
          console.log(chalk.gray('[PLAYWRIGHT]'), message);
        }
      });

      installProcess.stderr?.on('data', (data) => {
        hasOutput = true;
        const message = data.toString().trim();
        if (message) {
          console.log(chalk.gray('[PLAYWRIGHT]'), message);
        }
      });

      installProcess.on('exit', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          console.log(chalk.green('✅ Playwright chromium installed successfully!'));
          resolve();
        } else {
          reject(new Error(`Playwright installation failed with exit code ${code}`));
        }
      });

      installProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start Playwright installation: ${error.message}`));
      });

      // Check if process seems stuck
      setTimeout(() => {
        if (!hasOutput) {
          console.log(chalk.yellow('⚠️  Installation seems stuck. This is normal for the first run - downloading ~100MB...'));
        }
      }, 10000); // Show message after 10 seconds of no output
    });
  }

  private async takeScreenshot(page: Page, event: string): Promise<string | null> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${timestamp}-${event}.png`;
      const screenshotPath = join(this.screenshotDir, filename);
      
      await page.screenshot({ 
        path: screenshotPath,
        fullPage: false, // Just viewport for speed
        animations: 'disabled' // Disable animations during screenshot
      });
      
      // Return web-accessible URL (no need to copy since we save directly to MCP public dir)
      return `http://localhost:${this.options.mcpPort}/screenshots/${filename}`;
    } catch (error) {
      console.error(chalk.red('[SCREENSHOT ERROR]'), error);
      return null;
    }
  }

  private async setupPageMonitoring(page: Page) {
    const url = page.url();
    
    // Only monitor localhost pages
    if (!url.includes(`localhost:${this.options.port}`) && url !== 'about:blank') {
      return;
    }

    this.logger.log('browser', `📄 New page: ${url}`);
    
    // Console logs
    page.on('console', async (msg) => {
      if (page.url().includes(`localhost:${this.options.port}`)) {
        // Handle our interaction tracking logs specially
        const text = msg.text();
        if (text.startsWith('[DEV3000_INTERACTION]')) {
          const interaction = text.replace('[DEV3000_INTERACTION] ', '');
          this.logger.log('browser', `[INTERACTION] ${interaction}`);
          return;
        }

        // Try to reconstruct the console message properly
        let logMessage: string;
        try {
          // Get all arguments from the console message
          const args = msg.args();
          if (args.length === 0) {
            logMessage = text;
          } else if (args.length === 1) {
            // Single argument - use text() which is already formatted
            logMessage = text;
          } else {
            // Multiple arguments - format them properly
            const argValues = await Promise.all(
              args.map(async (arg) => {
                try {
                  const value = await arg.jsonValue();
                  return typeof value === 'object' ? JSON.stringify(value) : String(value);
                } catch {
                  return '[object]';
                }
              })
            );
            
            // Join all arguments with spaces (like normal console output)
            logMessage = argValues.join(' ');
          }
        } catch (error) {
          // Fallback to original text if args processing fails
          logMessage = text;
        }

        const level = msg.type().toUpperCase();
        this.logger.log('browser', `[CONSOLE ${level}] ${logMessage}`);
      }
    });
    
    // Page errors
    page.on('pageerror', async (error) => {
      if (page.url().includes(`localhost:${this.options.port}`)) {
        const screenshotPath = await this.takeScreenshot(page, 'error');
        this.logger.log('browser', `[PAGE ERROR] ${error.message}`);
        if (screenshotPath) {
          this.logger.log('browser', `[SCREENSHOT] ${screenshotPath}`);
        }
        if (error.stack) {
          this.logger.log('browser', `[PAGE ERROR STACK] ${error.stack}`);
        }
      }
    });
    
    // Network requests
    page.on('request', (request) => {
      if (page.url().includes(`localhost:${this.options.port}`) && !request.url().includes(`localhost:${this.options.mcpPort}`)) {
        this.logger.log('browser', `[NETWORK REQUEST] ${request.method()} ${request.url()}`);
      }
    });
    
    page.on('response', async (response) => {
      if (page.url().includes(`localhost:${this.options.port}`) && !response.url().includes(`localhost:${this.options.mcpPort}`)) {
        const status = response.status();
        const url = response.url();
        if (status >= 400) {
          const screenshotPath = await this.takeScreenshot(page, 'network-error');
          this.logger.log('browser', `[NETWORK ERROR] ${status} ${url}`);
          if (screenshotPath) {
            this.logger.log('browser', `[SCREENSHOT] ${screenshotPath}`);
          }
        }
      }
    });
    
    // Navigation (only screenshot on route changes, not every navigation)
    let lastRoute = '';
    page.on('framenavigated', async (frame) => {
      if (frame === page.mainFrame() && frame.url().includes(`localhost:${this.options.port}`)) {
        const currentRoute = new URL(frame.url()).pathname;
        this.logger.log('browser', `[NAVIGATION] ${frame.url()}`);
        
        // Only screenshot if route actually changed
        if (currentRoute !== lastRoute) {
          const screenshotPath = await this.takeScreenshot(page, 'route-change');
          if (screenshotPath) {
            this.logger.log('browser', `[SCREENSHOT] ${screenshotPath}`);
          }
          lastRoute = currentRoute;
        }
      }
    });

    // Set up user interaction tracking (clicks, scrolls, etc.)
    await this.setupInteractionTracking(page);
  }

  private async setupInteractionTracking(page: Page) {
    if (!page.url().includes(`localhost:${this.options.port}`)) {
      return;
    }

    try {
      // Inject interaction tracking scripts into the page
      await page.addInitScript(() => {
        // Track clicks and taps
        document.addEventListener('click', (event) => {
          const target = event.target as Element;
          const targetInfo = target.tagName.toLowerCase() + 
            (target.id ? `#${target.id}` : '') + 
            (target.className ? `.${target.className.split(' ').join('.')}` : '');
          
          console.log(`[DEV3000_INTERACTION] CLICK at (${event.clientX}, ${event.clientY}) on ${targetInfo}`);
        }, true);

        // Track touch events (mobile/tablet)
        document.addEventListener('touchstart', (event) => {
          if (event.touches.length > 0) {
            const touch = event.touches[0];
            const target = event.target as Element;
            const targetInfo = target.tagName.toLowerCase() + 
              (target.id ? `#${target.id}` : '') + 
              (target.className ? `.${target.className.split(' ').join('.')}` : '');
            
            console.log(`[DEV3000_INTERACTION] TAP at (${Math.round(touch.clientX)}, ${Math.round(touch.clientY)}) on ${targetInfo}`);
          }
        }, true);

        // Track scrolling with throttling to avoid spam
        let lastScrollTime = 0;
        let lastScrollY = window.scrollY;
        let lastScrollX = window.scrollX;
        
        document.addEventListener('scroll', () => {
          const now = Date.now();
          if (now - lastScrollTime > 500) { // Throttle to max once per 500ms
            const deltaY = window.scrollY - lastScrollY;
            const deltaX = window.scrollX - lastScrollX;
            
            if (Math.abs(deltaY) > 10 || Math.abs(deltaX) > 10) { // Only log significant scrolls
              const direction = deltaY > 0 ? 'DOWN' : deltaY < 0 ? 'UP' : deltaX > 0 ? 'RIGHT' : 'LEFT';
              const distance = Math.round(Math.sqrt(deltaX * deltaX + deltaY * deltaY));
              
              console.log(`[DEV3000_INTERACTION] SCROLL ${direction} ${distance}px to (${window.scrollX}, ${window.scrollY})`);
              
              lastScrollTime = now;
              lastScrollY = window.scrollY;
              lastScrollX = window.scrollX;
            }
          }
        }, true);

        // Track keyboard events (for form interactions)
        document.addEventListener('keydown', (event) => {
          const target = event.target as HTMLElement;
          if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true') {
            const targetInfo = target.tagName.toLowerCase() + 
              (target.id ? `#${target.id}` : '') + 
              ((target as any).type ? `[type=${(target as any).type}]` : '') +
              (target.className ? `.${target.className.split(' ').join('.')}` : '');
            
            // Log special keys, but not every character to avoid logging sensitive data
            if (event.key.length > 1) { // Special keys like 'Enter', 'Tab', 'Backspace', etc.
              console.log(`[DEV3000_INTERACTION] KEY ${event.key} in ${targetInfo}`);
            } else if (event.key === ' ') {
              console.log(`[DEV3000_INTERACTION] KEY Space in ${targetInfo}`);
            }
          }
        }, true);
      });

      // Note: Interaction logs will be captured by the existing console handler in setupPageMonitoring

    } catch (error) {
      console.warn('Could not set up interaction tracking:', error);
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
      
      // Clear the state saving timer
      this.stopStateSaving();
      
      // Try to save browser state quickly (with timeout) - non-intrusive
      if (this.browserContext) {
        try {
          console.log(chalk.blue('💾 Saving browser state...'));
          const savePromise = this.saveStateManually();
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 2000)
          );
          
          await Promise.race([savePromise, timeoutPromise]);
          console.log(chalk.green('✅ Browser state saved'));
        } catch (error) {
          console.log(chalk.gray('⚠️ Could not save browser state (timed out)'));
        }
      }
      
      // Close browser quickly (with timeout)
      if (this.browser) {
        try {
          if (this.browserType === 'system-chrome') {
            console.log(chalk.blue('🔄 Closing browser tab (keeping Chrome open)...'));
          } else {
            console.log(chalk.blue('🔄 Closing browser...'));
          }
          
          const closePromise = this.browser.close();
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 2000)
          );
          
          await Promise.race([closePromise, timeoutPromise]);
          console.log(chalk.green('✅ Browser closed'));
        } catch (error) {
          if (this.browserType === 'system-chrome') {
            console.log(chalk.gray('⚠️ Chrome tab close failed (this is normal - your Chrome stays open)'));
          } else {
            console.log(chalk.gray('⚠️ Browser close timed out'));
          }
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