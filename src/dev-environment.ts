import { spawn, ChildProcess } from 'child_process';
import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { writeFileSync, appendFileSync, mkdirSync, existsSync, copyFileSync, unlinkSync, readFileSync, symlinkSync } from 'fs';
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
    
    // Create symlink from default path to actual log file for consistent README reference
    const defaultLogPath = join(tmpdir(), 'dev-playwright-consolidated.log');
    if (this.logFile !== defaultLogPath) {
      try {
        // Remove existing symlink if it exists
        if (existsSync(defaultLogPath)) {
          unlinkSync(defaultLogPath);
        }
        // Create symlink
        symlinkSync(this.logFile, defaultLogPath);
      } catch (error) {
        // Symlink creation failed, but continue - not critical
        console.log(chalk.gray('⚠️ Could not create symlink for default log path'));
      }
    }
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

export class DevEnvironment {
  private serverProcess: ChildProcess | null = null;
  private mcpServerProcess: ChildProcess | null = null;
  private browserContext: BrowserContext | null = null;
  private logger: Logger;
  private options: DevEnvironmentOptions;
  private screenshotDir: string;
  private mcpPublicDir: string;
  private pidFile: string;
  private progressBar: cliProgress.SingleBar;

  constructor(options: DevEnvironmentOptions) {
    this.options = options;
    this.logger = new Logger(options.logFile);
    this.screenshotDir = join(dirname(options.logFile), 'screenshots');
    this.pidFile = join(tmpdir(), 'dev-playwright.pid');
    
    // Set up MCP server public directory for web-accessible screenshots
    const currentFile = fileURLToPath(import.meta.url);
    const packageRoot = dirname(dirname(currentFile));
    this.mcpPublicDir = join(packageRoot, 'mcp-server', 'public', 'screenshots');
    
    // Initialize progress bar
    this.progressBar = new cliProgress.SingleBar({
      format: chalk.blue('Starting dev-playwright') + ' |' + chalk.cyan('{bar}') + '| {percentage}% | {stage}',
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
        console.log(chalk.blue(`🔍 Checking port ${port}...`));
        const result = await new Promise<string>((resolve) => {
          const proc = spawn('lsof', ['-ti', `:${port}`], { stdio: 'pipe' });
          let output = '';
          proc.stdout?.on('data', (data) => output += data.toString());
          proc.on('exit', () => resolve(output.trim()));
        });
        
        if (result) {
          const pids = result.split('\n').filter(line => line.trim());
          
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
    console.log(chalk.blue('🚀 Starting development environment...'));
    console.log(chalk.green.bold(`📊 Consolidated Log: ${this.options.logFile}`));
    console.log(chalk.gray('💡 Give Claude this log file path for AI debugging!\n'));
    
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
    
    // Wait for both servers to be ready
    await this.waitForServer();
    this.progressBar.update(50, { stage: 'Waiting for MCP server...' });
    await this.waitForMcpServer();
    this.progressBar.update(70, { stage: 'Starting browser...' });
    
    // Start browser monitoring
    await this.startBrowserMonitoring();
    this.progressBar.update(100, { stage: 'Complete!' });
    
    // Stop progress bar and show results
    this.progressBar.stop();
    
    console.log(chalk.green('\n✅ Development environment ready!'));
    console.log(chalk.blue(`📊 Logs: ${this.options.logFile}`));
    console.log(chalk.yellow('💡 Give this to an AI to auto debug and fix your app\n'));
    console.log(chalk.blue(`🌐 Your App: http://localhost:${this.options.port}`));
    console.log(chalk.blue(`🤖 MCP Server: http://localhost:${this.options.mcpPort}/api/mcp/http`));
    console.log(chalk.magenta(`📸 Visual Timeline: http://localhost:${this.options.mcpPort}/logs`));
    console.log(chalk.gray('\n💡 To stop all servers and kill playwright: Ctrl-C'));
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
        // Only show critical server errors in stdout
        if (message.includes('FATAL') || message.includes('Error:')) {
          console.error(chalk.red('[SERVER ERROR]'), message);
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
    
    // Read version from package.json
    const versionCurrentFile = fileURLToPath(import.meta.url);
    const versionPackageRoot = dirname(dirname(versionCurrentFile));
    const packageJsonPath = join(versionPackageRoot, 'package.json');
    let version = '0.0.0';
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      version = packageJson.version;
    } catch (error) {
      console.log(chalk.yellow('⚠️ Could not read version from package.json'));
    }

    // Start the MCP server using detected package manager
    const packageManagerForRun = detectPackageManagerForRun();
    this.mcpServerProcess = spawn(packageManagerForRun, ['run', 'dev'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      detached: true, // Run independently
      cwd: mcpServerPath,
      env: {
        ...process.env,
        PORT: this.options.mcpPort,
        LOG_FILE_PATH: this.options.logFile, // Pass log file path to MCP server
        DEV_PLAYWRIGHT_VERSION: version, // Pass version to MCP server
      },
    });

    // Log MCP server output (to file only, reduce stdout noise)
    this.mcpServerProcess.stdout?.on('data', (data) => {
      const message = data.toString().trim();
      if (message) {
        this.logger.log('server', message);
      }
    });

    this.mcpServerProcess.stderr?.on('data', (data) => {
      const message = data.toString().trim();
      if (message) {
        this.logger.log('server', `ERROR: ${message}`);
        // Only show critical MCP server errors in stdout
        if (message.includes('FATAL') || message.includes('Error:')) {
          console.error(chalk.red('[LOG VIEWER ERROR]'), message);
        }
      }
    });

    this.mcpServerProcess.on('exit', (code) => {
      console.log(chalk.red(`MCP server process exited with code ${code}`));
    });
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
      this.browserContext = await chromium.launchPersistentContext(this.options.profileDir, {
        headless: false,
        channel: 'chrome', // Use system Chrome
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 2,
        args: [
          '--remote-debugging-port=9222',
          '--disable-web-security',
          '--disable-blink-features=AutomationControlled',
        ],
      });
    } catch (error: any) {
      // Fallback to Playwright's bundled chromium
      try {
        this.browserContext = await chromium.launchPersistentContext(this.options.profileDir, {
          headless: false,
          viewport: { width: 1280, height: 720 },
          deviceScaleFactor: 2,
          args: [
            '--remote-debugging-port=9222',
            '--disable-web-security',
            '--disable-blink-features=AutomationControlled',
          ],
        });
      } catch (playwrightError: any) {
        if (playwrightError.message?.includes('Executable doesn\'t exist')) {
          const packageManager = detectPackageManager();
          console.log(chalk.yellow('📦 Installing Playwright chromium browser...'));
          await this.installPlaywrightBrowsers();
          
          // Retry with bundled chromium
          this.browserContext = await chromium.launchPersistentContext(this.options.profileDir, {
            headless: false,
            viewport: { width: 1280, height: 720 },
            deviceScaleFactor: 2,
            args: [
              '--remote-debugging-port=9222',
              '--disable-web-security',
              '--disable-blink-features=AutomationControlled',
            ],
          });
        } else {
          throw playwrightError;
        }
      }
    }
    
    // Navigate to the app
    const page = await this.browserContext.newPage();
    await page.goto(`http://localhost:${this.options.port}`);
    
    // Take initial screenshot
    const initialScreenshot = await this.takeScreenshot(page, 'initial-load');
    if (initialScreenshot) {
      this.logger.log('browser', `[SCREENSHOT] ${initialScreenshot}`);
    }
    
    // Set up monitoring
    await this.setupPageMonitoring(page);
    
    // Monitor new pages
    this.browserContext.on('page', async (newPage) => {
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
      const mcpScreenshotPath = join(this.mcpPublicDir, filename);
      
      await page.screenshot({ 
        path: screenshotPath,
        fullPage: false, // Just viewport for speed
        animations: 'disabled' // Disable animations during screenshot
      });
      
      // Copy to MCP server public folder for web access
      copyFileSync(screenshotPath, mcpScreenshotPath);
      
      // Return web-accessible URL
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
    page.on('console', (msg) => {
      if (page.url().includes(`localhost:${this.options.port}`)) {
        const level = msg.type().toUpperCase();
        const text = msg.text();
        this.logger.log('browser', `[CONSOLE ${level}] ${text}`);
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
  }

  private setupCleanupHandlers() {
    // Handle Ctrl+C to kill all processes
    process.on('SIGINT', async () => {
      console.log(chalk.yellow('\n🛑 Received interrupt signal. Cleaning up processes...'));
      
      // Kill processes on both ports
      const killPortProcess = async (port: string, name: string) => {
        try {
          const { spawn } = await import('child_process');
          const killProcess = spawn('sh', ['-c', `lsof -ti:${port} | xargs kill -9`], { stdio: 'inherit' });
          killProcess.on('exit', (code) => {
            if (code === 0) {
              console.log(chalk.green(`✅ Killed ${name} on port ${port}`));
            }
          });
        } catch (error) {
          console.log(chalk.gray(`⚠️ Could not kill ${name} on port ${port}`));
        }
      };
      
      await Promise.all([
        killPortProcess(this.options.port, 'your app server'),
        killPortProcess(this.options.mcpPort, 'dev-playwright MCP server')
      ]);
      
      // Close browser if still running
      if (this.browserContext) {
        try {
          console.log(chalk.blue('🔄 Closing browser...'));
          await this.browserContext.close();
          console.log(chalk.green('✅ Browser closed'));
        } catch (error) {
          console.log(chalk.gray('⚠️ Could not close browser gracefully'));
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