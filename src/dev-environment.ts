import { spawn, ChildProcess } from 'child_process';
import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

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
  }

  log(source: 'server' | 'browser', message: string) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${source.toUpperCase()}] ${message}\n`;
    appendFileSync(this.logFile, logEntry);
  }
}

export class DevEnvironment {
  private serverProcess: ChildProcess | null = null;
  private mcpServerProcess: ChildProcess | null = null;
  private browserContext: BrowserContext | null = null;
  private logger: Logger;
  private options: DevEnvironmentOptions;

  constructor(options: DevEnvironmentOptions) {
    this.options = options;
    this.logger = new Logger(options.logFile);
  }

  async start() {
    console.log(chalk.blue('🚀 Starting development environment...'));
    
    // Setup cleanup handlers
    this.setupCleanupHandlers();
    
    // Start user's dev server
    await this.startServer();
    
    // Start MCP server
    await this.startMcpServer();
    
    // Wait for both servers to be ready
    await this.waitForServer();
    await this.waitForMcpServer();
    
    // Start browser monitoring
    await this.startBrowserMonitoring();
    
    console.log(chalk.green('\n✅ Development environment ready!'));
    console.log(chalk.blue(`📊 Logs: ${this.options.logFile}`));
    console.log(chalk.blue(`🌐 App: http://localhost:${this.options.port}`));
    console.log(chalk.blue(`🤖 MCP Server: http://localhost:${this.options.mcpPort}/api/mcp/http`));
    console.log(chalk.yellow('Press Ctrl+C to stop all processes'));
    
    // Keep alive
    return new Promise<void>((resolve) => {
      // The process will be kept alive by the cleanup handlers
    });
  }

  private async startServer() {
    console.log(chalk.blue(`🔧 Starting server: ${this.options.serverCommand}`));
    
    const [command, ...args] = this.options.serverCommand.split(' ');
    
    this.serverProcess = spawn(command, args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
    });

    // Log server output
    this.serverProcess.stdout?.on('data', (data) => {
      const message = data.toString().trim();
      if (message) {
        this.logger.log('server', message);
        // Also show in console with prefix
        console.log(chalk.gray('[SERVER]'), message);
      }
    });

    this.serverProcess.stderr?.on('data', (data) => {
      const message = data.toString().trim();
      if (message) {
        this.logger.log('server', `ERROR: ${message}`);
        console.error(chalk.red('[SERVER ERROR]'), message);
      }
    });

    this.serverProcess.on('exit', (code) => {
      console.log(chalk.red(`Server process exited with code ${code}`));
    });
  }

  private async startMcpServer() {
    console.log(chalk.blue(`🤖 Starting MCP server on port ${this.options.mcpPort}...`));
    
    // Get the path to our bundled MCP server
    const currentFile = fileURLToPath(import.meta.url);
    const packageRoot = dirname(dirname(currentFile)); // Go up from dist/ to package root
    const mcpServerPath = join(packageRoot, 'mcp-server');
    
    // Start the MCP server
    this.mcpServerProcess = spawn('npm', ['run', 'dev'], {
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
      cwd: mcpServerPath,
      env: {
        ...process.env,
        PORT: this.options.mcpPort,
      },
    });

    // Log MCP server output
    this.mcpServerProcess.stdout?.on('data', (data) => {
      const message = data.toString().trim();
      if (message) {
        this.logger.log('server', `[MCP] ${message}`);
        console.log(chalk.gray('[MCP]'), message);
      }
    });

    this.mcpServerProcess.stderr?.on('data', (data) => {
      const message = data.toString().trim();
      if (message) {
        this.logger.log('server', `[MCP ERROR] ${message}`);
        console.error(chalk.red('[MCP ERROR]'), message);
      }
    });

    this.mcpServerProcess.on('exit', (code) => {
      console.log(chalk.red(`MCP server process exited with code ${code}`));
    });
  }

  private async waitForServer() {
    console.log(chalk.blue('⏳ Waiting for server to be ready...'));
    
    const maxAttempts = 30;
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      try {
        const response = await fetch(`http://localhost:${this.options.port}`, {
          method: 'HEAD',
        });
        if (response.ok || response.status === 404) {
          console.log(chalk.green('✅ Server is ready!'));
          return;
        }
      } catch (error) {
        // Server not ready yet
      }
      
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error('Server failed to start within 30 seconds');
  }

  private async waitForMcpServer() {
    console.log(chalk.blue('⏳ Waiting for MCP server to be ready...'));
    
    const maxAttempts = 30;
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      try {
        const response = await fetch(`http://localhost:${this.options.mcpPort}`, {
          method: 'HEAD',
        });
        if (response.ok || response.status === 404) {
          console.log(chalk.green('✅ MCP server is ready!'));
          return;
        }
      } catch (error) {
        // MCP server not ready yet
      }
      
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error('MCP server failed to start within 30 seconds');
  }

  private async startBrowserMonitoring() {
    console.log(chalk.blue('🌐 Starting browser monitoring...'));
    
    // Ensure profile directory exists
    if (!existsSync(this.options.profileDir)) {
      mkdirSync(this.options.profileDir, { recursive: true });
    }
    
    try {
      // Launch browser with persistent context
      this.browserContext = await chromium.launchPersistentContext(this.options.profileDir, {
        headless: false,
        args: [
          '--remote-debugging-port=9222',
          '--disable-web-security',
          '--disable-blink-features=AutomationControlled',
        ],
      });
    } catch (error: any) {
      // Check if it's a missing browser error
      if (error.message?.includes('Executable doesn\'t exist')) {
        console.log(chalk.yellow('📦 Playwright browsers not found. Installing automatically...'));
        await this.installPlaywrightBrowsers();
        
        // Retry browser launch
        this.browserContext = await chromium.launchPersistentContext(this.options.profileDir, {
          headless: false,
          args: [
            '--remote-debugging-port=9222',
            '--disable-web-security',
            '--disable-blink-features=AutomationControlled',
          ],
        });
      } else {
        throw error;
      }
    }
    
    // Navigate to the app
    const page = await this.browserContext.newPage();
    await page.goto(`http://localhost:${this.options.port}`);
    
    // Set up monitoring
    await this.setupPageMonitoring(page);
    
    // Monitor new pages
    this.browserContext.on('page', async (newPage) => {
      await this.setupPageMonitoring(newPage);
    });
    
    console.log(chalk.green('✅ Browser monitoring active!'));
  }

  private async installPlaywrightBrowsers() {
    console.log(chalk.blue('⏳ Installing Playwright browsers (this may take a few minutes)...'));
    
    return new Promise<void>((resolve, reject) => {
      // Use node with playwright installation script directly
      const installProcess = spawn('node', ['-e', `
        const { execSync } = require('child_process');
        try {
          // Install playwright and then install browsers
          console.log('Installing playwright...');
          execSync('npm install playwright@^1.49.0', { stdio: 'inherit' });
          console.log('Installing chromium browser...');
          execSync('npx playwright install chromium', { stdio: 'inherit' });
          console.log('Installation complete!');
        } catch (error) {
          console.error('Installation failed:', error.message);
          process.exit(1);
        }
      `], {
        stdio: ['inherit', 'pipe', 'pipe'],
        shell: false,
      });

      installProcess.stdout?.on('data', (data) => {
        const message = data.toString().trim();
        if (message) {
          console.log(chalk.gray('[PLAYWRIGHT]'), message);
        }
      });

      installProcess.stderr?.on('data', (data) => {
        const message = data.toString().trim();
        if (message) {
          console.log(chalk.gray('[PLAYWRIGHT]'), message);
        }
      });

      installProcess.on('exit', (code) => {
        if (code === 0) {
          console.log(chalk.green('✅ Playwright browsers installed successfully!'));
          resolve();
        } else {
          reject(new Error(`Playwright installation failed with code ${code}`));
        }
      });

      installProcess.on('error', (error) => {
        reject(new Error(`Failed to start Playwright installation: ${error.message}`));
      });
    });
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
        console.log(chalk.cyan('[BROWSER]'), `[${level}]`, text);
      }
    });
    
    // Page errors
    page.on('pageerror', (error) => {
      if (page.url().includes(`localhost:${this.options.port}`)) {
        this.logger.log('browser', `[PAGE ERROR] ${error.message}`);
        if (error.stack) {
          this.logger.log('browser', `[PAGE ERROR STACK] ${error.stack}`);
        }
        console.error(chalk.red('[BROWSER ERROR]'), error.message);
      }
    });
    
    // Network requests
    page.on('request', (request) => {
      if (page.url().includes(`localhost:${this.options.port}`)) {
        this.logger.log('browser', `[NETWORK REQUEST] ${request.method()} ${request.url()}`);
      }
    });
    
    page.on('response', (response) => {
      if (page.url().includes(`localhost:${this.options.port}`)) {
        const status = response.status();
        const url = response.url();
        if (status >= 400) {
          this.logger.log('browser', `[NETWORK ERROR] ${status} ${url}`);
          console.error(chalk.red('[NETWORK ERROR]'), status, url);
        }
      }
    });
    
    // Navigation
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && frame.url().includes(`localhost:${this.options.port}`)) {
        this.logger.log('browser', `[NAVIGATION] ${frame.url()}`);
        console.log(chalk.magenta('[BROWSER]'), `Navigated to: ${frame.url()}`);
      }
    });
  }

  private setupCleanupHandlers() {
    const cleanup = async () => {
      console.log(chalk.yellow('\n🧹 Shutting down development environment...'));
      
      if (this.browserContext) {
        console.log(chalk.blue('🔄 Closing browser...'));
        await this.browserContext.close();
      }
      
      if (this.serverProcess) {
        console.log(chalk.blue('🔄 Stopping server...'));
        this.serverProcess.kill('SIGTERM');
        
        // Force kill after 5 seconds
        setTimeout(() => {
          if (this.serverProcess && !this.serverProcess.killed) {
            this.serverProcess.kill('SIGKILL');
          }
        }, 5000);
      }

      if (this.mcpServerProcess) {
        console.log(chalk.blue('🔄 Stopping MCP server...'));
        this.mcpServerProcess.kill('SIGTERM');
        
        // Force kill after 5 seconds
        setTimeout(() => {
          if (this.mcpServerProcess && !this.mcpServerProcess.killed) {
            this.mcpServerProcess.kill('SIGKILL');
          }
        }, 5000);
      }
      
      console.log(chalk.green('✅ Cleanup complete'));
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', cleanup);
  }
}

export async function startDevEnvironment(options: DevEnvironmentOptions) {
  const devEnv = new DevEnvironment(options);
  await devEnv.start();
}