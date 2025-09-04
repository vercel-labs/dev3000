import { spawn, ChildProcess } from 'child_process';
import { WebSocket } from 'ws';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export interface CDPEvent {
  method: string;
  params: any;
  timestamp: number;
  sessionId?: string;
}

export interface CDPConnection {
  ws: WebSocket;
  sessionId: string | null;
  nextId: number;
}

export class CDPMonitor {
  private browser: ChildProcess | null = null;
  private connection: CDPConnection | null = null;
  private debugPort: number = 9222;
  private eventHandlers = new Map<string, (event: CDPEvent) => void>();
  private profileDir: string;
  private logger: (source: string, message: string) => void;
  private debug: boolean = false;
  private isShuttingDown = false;

  constructor(profileDir: string, logger: (source: string, message: string) => void, debug: boolean = false) {
    this.profileDir = profileDir;
    this.logger = logger;
    this.debug = debug;
  }

  private debugLog(message: string) {
    if (this.debug) {
      console.log(`[CDP DEBUG] ${message}`);
    }
  }

  async start(): Promise<void> {
    // Launch Chrome with CDP enabled
    this.debugLog('Starting Chrome launch process');
    await this.launchChrome();
    this.debugLog('Chrome launch completed');
    
    // Connect to Chrome DevTools Protocol
    this.debugLog('Starting CDP connection');
    await this.connectToCDP();
    this.debugLog('CDP connection completed');
    
    // Enable all the CDP domains we need for comprehensive monitoring
    this.debugLog('Starting CDP domain enablement');
    await this.enableCDPDomains();
    this.debugLog('CDP domain enablement completed');
    
    // Setup event handlers for comprehensive logging
    this.debugLog('Setting up CDP event handlers');
    this.setupEventHandlers();
    this.debugLog('CDP event handlers setup completed');
  }

  private createLoadingPage(): string {
    const loadingDir = join(tmpdir(), 'dev3000-loading');
    if (!existsSync(loadingDir)) {
      mkdirSync(loadingDir, { recursive: true });
    }
    
    const loadingPath = join(loadingDir, 'loading.html');
    const loadingHtml = `<!DOCTYPE html>
<html>
<head>
  <title>dev3000 - Starting...</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      color: white;
    }
    .container {
      text-align: center;
      padding: 40px;
      border-radius: 12px;
      background: rgba(255,255,255,0.1);
      backdrop-filter: blur(10px);
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid rgba(255,255,255,0.3);
      border-top: 3px solid white;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    h1 { margin: 0 0 10px; font-size: 24px; font-weight: 600; }
    p { margin: 0; opacity: 0.9; font-size: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <h1>dev3000</h1>
    <p>Starting your development environment...</p>
  </div>
</body>
</html>`;
    
    writeFileSync(loadingPath, loadingHtml);
    return `file://${loadingPath}`;
  }

  private async launchChrome(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Try different Chrome executables based on platform
      const chromeCommands = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        'google-chrome',
        'chrome',
        'chromium'
      ];
      
      this.debugLog(`Attempting to launch Chrome for CDP monitoring on port ${this.debugPort}`);
      this.debugLog(`Profile directory: ${this.profileDir}`);
      
      let chromePath = chromeCommands[0]; // Default to macOS path
      this.debugLog(`Using Chrome path: ${chromePath}`);
      
      this.browser = spawn(chromePath, [
        `--remote-debugging-port=${this.debugPort}`,
        `--user-data-dir=${this.profileDir}`,
        '--no-first-run',
        this.createLoadingPage()
      ], {
        stdio: 'pipe',
        detached: false
      });

      if (!this.browser) {
        reject(new Error('Failed to launch Chrome'));
        return;
      }

      this.browser.on('error', (error) => {
        this.debugLog(`Chrome launch error: ${error.message}`);
        if (!this.isShuttingDown) {
          reject(error);
        }
      });

      this.browser.stderr?.on('data', (data) => {
        this.debugLog(`Chrome stderr: ${data.toString().trim()}`);
      });

      this.browser.stdout?.on('data', (data) => {
        this.debugLog(`Chrome stdout: ${data.toString().trim()}`);
      });

      // Give Chrome time to start up
      setTimeout(() => {
        this.debugLog('Chrome startup timeout reached, assuming success');
        resolve();
      }, 3000);
    });
  }

  private async connectToCDP(): Promise<void> {
    this.debugLog(`Attempting to connect to CDP on port ${this.debugPort}`);
    
    // Retry connection with exponential backoff
    let retryCount = 0;
    const maxRetries = 5;
    
    while (retryCount < maxRetries) {
      try {
        // Get the WebSocket URL from Chrome's debug endpoint
        const targetsResponse = await fetch(`http://localhost:${this.debugPort}/json`);
        const targets = await targetsResponse.json();
        
        // Find the first page target (tab)
        const pageTarget = targets.find((target: any) => target.type === 'page');
        if (!pageTarget) {
          throw new Error('No page target found in Chrome');
        }
        
        const wsUrl = pageTarget.webSocketDebuggerUrl;
        this.debugLog(`Found page target: ${pageTarget.title || 'Unknown'} - ${pageTarget.url}`);
        this.debugLog(`Got CDP WebSocket URL: ${wsUrl}`);

        return new Promise((resolve, reject) => {
          this.debugLog(`Creating WebSocket connection to: ${wsUrl}`);
          const ws = new WebSocket(wsUrl);
          
          // Increase max listeners to prevent warnings
          ws.setMaxListeners(20);
          
          ws.on('open', () => {
            this.debugLog('WebSocket connection opened successfully');
            this.connection = {
              ws,
              sessionId: null,
              nextId: 1
            };
            resolve();
          });

          ws.on('error', (error) => {
            this.debugLog(`WebSocket connection error: ${error}`);
            reject(error);
          });

          ws.on('message', (data) => {
            try {
              const message = JSON.parse(data.toString());
              this.handleCDPMessage(message);
            } catch (error) {
              this.logger('browser', `[CDP ERROR] Failed to parse message: ${error}`);
            }
          });

          ws.on('close', (code, reason) => {
            this.debugLog(`WebSocket closed with code ${code}, reason: ${reason}`);
            if (!this.isShuttingDown) {
              this.logger('browser', `[CDP] Connection closed unexpectedly (code: ${code}, reason: ${reason})`);
            }
          });
          
          // Connection timeout
          setTimeout(() => {
            this.debugLog(`WebSocket readyState: ${ws.readyState} (CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3)`);
            if (ws.readyState === WebSocket.CONNECTING) {
              this.debugLog('WebSocket connection timed out, closing');
              ws.close();
              reject(new Error('CDP connection timeout'));
            }
          }, 5000);
        });
      } catch (error) {
        retryCount++;
        this.debugLog(`CDP connection attempt ${retryCount} failed: ${error}`);
        
        if (retryCount >= maxRetries) {
          throw new Error(`Failed to connect to CDP after ${maxRetries} attempts: ${error}`);
        }
        
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
        this.debugLog(`Retrying CDP connection in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  private async sendCDPCommand(method: string, params: any = {}): Promise<any> {
    if (!this.connection) {
      throw new Error('No CDP connection available');
    }

    return new Promise((resolve, reject) => {
      const id = this.connection!.nextId++;
      const command = {
        id,
        method,
        params,
      };

      const messageHandler = (data: any) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.id === id) {
            this.connection!.ws.removeListener('message', messageHandler);
            if (message.error) {
              reject(new Error(message.error.message));
            } else {
              resolve(message.result);
            }
          }
        } catch (error) {
          this.connection!.ws.removeListener('message', messageHandler);
          reject(error);
        }
      };

      this.connection!.ws.on('message', messageHandler);
      
      // Command timeout
      const timeout = setTimeout(() => {
        this.connection!.ws.removeListener('message', messageHandler);
        reject(new Error(`CDP command timeout: ${method}`));
      }, 10000);
      
      // Clear timeout if command succeeds/fails
      const originalResolve = resolve;
      const originalReject = reject;
      resolve = (value: any) => {
        clearTimeout(timeout);
        originalResolve(value);
      };
      reject = (reason: any) => {
        clearTimeout(timeout);
        originalReject(reason);
      };

      this.connection!.ws.send(JSON.stringify(command));
    });
  }

  private async enableCDPDomains(): Promise<void> {
    const domains = [
      'Runtime',        // Console logs, exceptions
      'Network',        // Network requests/responses
      'Page',          // Page events, navigation
      'DOM',           // DOM mutations
      'Performance',   // Performance metrics
      'Security',      // Security events
      'Log'            // Browser console logs
    ];

    for (const domain of domains) {
      try {
        this.debugLog(`Enabling CDP domain: ${domain}`);
        await this.sendCDPCommand(`${domain}.enable`);
        this.debugLog(`Successfully enabled CDP domain: ${domain}`);
        this.logger('browser', `[CDP] Enabled ${domain} domain`);
      } catch (error) {
        this.debugLog(`Failed to enable CDP domain ${domain}: ${error}`);
        this.logger('browser', `[CDP ERROR] Failed to enable ${domain}: ${error}`);
        // Continue with other domains instead of throwing
      }
    }

    this.debugLog('Setting up input event capturing');
    await this.sendCDPCommand('Input.setIgnoreInputEvents', { ignore: false });
    
    this.debugLog('Enabling runtime for console and exception capture');
    await this.sendCDPCommand('Runtime.enable');
    await this.sendCDPCommand('Runtime.setAsyncCallStackDepth', { maxDepth: 32 });
    this.debugLog('CDP domains enabled successfully');
  }

  private setupEventHandlers(): void {
    // Console messages with full context
    this.onCDPEvent('Runtime.consoleAPICalled', (event) => {
      this.debugLog(`Runtime.consoleAPICalled event received: ${event.params.type}`);
      const { type, args, stackTrace } = event.params;
      
      // Check if this is our interaction tracking
      if (args.length > 0 && args[0].value?.includes('[DEV3000_INTERACTION]')) {
        const interaction = args[0].value.replace('[DEV3000_INTERACTION] ', '');
        this.logger('browser', `[INTERACTION] ${interaction}`);
        return;
      }

      // Log regular console messages with enhanced context
      const values = args.map((arg: any) => {
        if (arg.type === 'object' && arg.preview) {
          return JSON.stringify(arg.preview);
        }
        return arg.value || '[object]';
      }).join(' ');

      let logMsg = `[CONSOLE ${type.toUpperCase()}] ${values}`;
      
      // Add stack trace for errors
      if (stackTrace && (type === 'error' || type === 'assert')) {
        logMsg += `\n[STACK] ${stackTrace.callFrames.slice(0, 3).map((frame: any) => 
          `${frame.functionName || 'anonymous'}@${frame.url}:${frame.lineNumber}`
        ).join(' -> ')}`;
      }

      this.logger('browser', logMsg);
    });

    // Runtime exceptions with full stack traces
    this.onCDPEvent('Runtime.exceptionThrown', (event) => {
      this.debugLog('Runtime.exceptionThrown event received');
      const { exceptionDetails } = event.params;
      const { text, lineNumber, columnNumber, url, stackTrace } = exceptionDetails;
      
      let errorMsg = `[RUNTIME ERROR] ${text}`;
      if (url) errorMsg += ` at ${url}:${lineNumber}:${columnNumber}`;
      
      if (stackTrace) {
        errorMsg += `\n[STACK] ${stackTrace.callFrames.slice(0, 5).map((frame: any) => 
          `${frame.functionName || 'anonymous'}@${frame.url}:${frame.lineNumber}`
        ).join(' -> ')}`;
      }

      this.logger('browser', errorMsg);
    });

    // Browser console logs via Log domain (additional capture method)
    this.onCDPEvent('Log.entryAdded', (event) => {
      const { entry } = event.params;
      const { level, text, source, url, lineNumber } = entry;
      
      let logMsg = `[CONSOLE ${level.toUpperCase()}] ${text}`;
      if (url && lineNumber) {
        logMsg += ` at ${url}:${lineNumber}`;
      }
      
      // Only log if it's an error/warning or if we're not already capturing it via Runtime
      if (level === 'error' || level === 'warning') {
        this.logger('browser', logMsg);
      }
    });

    // Network requests with full details
    this.onCDPEvent('Network.requestWillBeSent', (event) => {
      const { request, type, initiator } = event.params;
      const { url, method, headers, postData } = request;
      
      let logMsg = `[NETWORK REQUEST] ${method} ${url}`;
      if (type) logMsg += ` (${type})`;
      if (initiator?.type) logMsg += ` initiated by ${initiator.type}`;
      
      // Log important headers
      const importantHeaders = ['content-type', 'authorization', 'cookie'];
      const headerInfo = importantHeaders
        .filter(h => headers[h])
        .map(h => `${h}: ${headers[h].slice(0, 50)}${headers[h].length > 50 ? '...' : ''}`)
        .join(', ');
      
      if (headerInfo) logMsg += ` [${headerInfo}]`;
      if (postData) logMsg += ` body: ${postData.slice(0, 100)}${postData.length > 100 ? '...' : ''}`;

      this.logger('browser', logMsg);
    });

    // Network responses with full details
    this.onCDPEvent('Network.responseReceived', (event) => {
      const { response, type } = event.params;
      const { url, status, statusText, mimeType } = response;
      
      let logMsg = `[NETWORK RESPONSE] ${status} ${statusText} ${url}`;
      if (type) logMsg += ` (${type})`;
      if (mimeType) logMsg += ` [${mimeType}]`;
      
      // Add timing info if available
      const timing = response.timing;
      if (timing) {
        const totalTime = Math.round(timing.receiveHeadersEnd - timing.requestTime);
        if (totalTime > 0) logMsg += ` (${totalTime}ms)`;
      }

      this.logger('browser', logMsg);
    });

    // Page navigation with full context
    this.onCDPEvent('Page.frameNavigated', (event) => {
      const { frame } = event.params;
      if (frame.parentId) return; // Only log main frame navigation
      
      this.logger('browser', `[NAVIGATION] ${frame.url}`);
      
      // Take screenshot after navigation
      setTimeout(() => {
        this.takeScreenshot('navigation');
      }, 1000);
    });

    // DOM mutations for interaction context
    this.onCDPEvent('DOM.documentUpdated', () => {
      // Document structure changed - useful for SPA routing
      this.logger('browser', '[DOM] Document updated');
    });

    // Performance metrics - disabled to reduce log noise
    // this.onCDPEvent('Performance.metrics', (event) => {
    //   const metrics = event.params.metrics;
    //   const importantMetrics = metrics.filter((m: any) => 
    //     ['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'Documents'].includes(m.name)
    //   );
    //   
    //   if (importantMetrics.length > 0) {
    //     const metricsStr = importantMetrics
    //       .map((m: any) => `${m.name}:${Math.round(m.value)}`)
    //       .join(' ');
    //     this.logger('browser', `[PERFORMANCE] ${metricsStr}`);
    //   }
    // });
  }

  private onCDPEvent(method: string, handler: (event: CDPEvent) => void): void {
    this.eventHandlers.set(method, handler);
  }

  private handleCDPMessage(message: any): void {
    if (message.method) {
      const handler = this.eventHandlers.get(message.method);
      if (handler) {
        const event: CDPEvent = {
          method: message.method,
          params: message.params || {},
          timestamp: Date.now(),
          sessionId: message.sessionId
        };
        handler(event);
      }
    }
  }

  async navigateToApp(port: string): Promise<void> {
    if (!this.connection) {
      throw new Error('No CDP connection available');
    }

    this.debugLog(`Navigating to http://localhost:${port}`);
    // Navigate to the app
    await this.sendCDPCommand('Page.navigate', { 
      url: `http://localhost:${port}` 
    });
    this.debugLog('Navigation command sent successfully');

    this.debugLog('Setting up interaction tracking');
    // Enable interaction tracking via Runtime.evaluate
    await this.setupInteractionTracking();
    this.debugLog('Interaction tracking setup completed');
  }

  private async setupInteractionTracking(): Promise<void> {
    // Inject comprehensive interaction tracking
    const trackingScript = `
      // Only inject once
      if (window.__dev3000_cdp_tracking) return;
      window.__dev3000_cdp_tracking = true;

      // Track all mouse events
      ['click', 'mousedown', 'mouseup', 'mousemove'].forEach(eventType => {
        document.addEventListener(eventType, (event) => {
          const target = event.target;
          const rect = target.getBoundingClientRect();
          
          const interactionData = {
            type: eventType.toUpperCase(),
            timestamp: Date.now(),
            coordinates: { 
              x: event.clientX, 
              y: event.clientY,
              elementX: event.clientX - rect.left,
              elementY: event.clientY - rect.top
            },
            target: {
              selector: target.tagName.toLowerCase() + 
                (target.id ? '#' + target.id : '') + 
                (target.className ? '.' + target.className.split(' ').join('.') : ''),
              text: target.textContent?.slice(0, 100) || null,
              attributes: {
                id: target.id || null,
                className: target.className || null,
                type: target.type || null,
                href: target.href || null
              },
              bounds: {
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              }
            },
            viewport: { 
              width: window.innerWidth, 
              height: window.innerHeight 
            },
            scroll: { 
              x: window.scrollX, 
              y: window.scrollY 
            },
            modifiers: {
              ctrl: event.ctrlKey,
              alt: event.altKey,
              shift: event.shiftKey,
              meta: event.metaKey
            }
          };
          
          console.log('[DEV3000_INTERACTION] ' + JSON.stringify(interactionData));
        }, true);
      });

      // Track keyboard events with enhanced context
      document.addEventListener('keydown', (event) => {
        const target = event.target;
        
        const interactionData = {
          type: 'KEYDOWN',
          timestamp: Date.now(),
          key: event.key,
          code: event.code,
          target: {
            selector: target.tagName.toLowerCase() + 
              (target.id ? '#' + target.id : '') + 
              (target.className ? '.' + target.className.split(' ').join('.') : ''),
            value: target.value?.slice(0, 50) || null,
            attributes: {
              type: target.type || null,
              placeholder: target.placeholder || null
            }
          },
          modifiers: {
            ctrl: event.ctrlKey,
            alt: event.altKey,
            shift: event.shiftKey,
            meta: event.metaKey
          }
        };
        
        // Only log special keys and form interactions
        if (event.key.length > 1 || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          console.log('[DEV3000_INTERACTION] ' + JSON.stringify(interactionData));
        }
      }, true);

      // Track scroll events with momentum detection
      let scrollTimeout;
      let lastScrollTime = 0;
      let scrollStartTime = 0;
      let lastScrollPos = { x: window.scrollX, y: window.scrollY };

      document.addEventListener('scroll', () => {
        const now = Date.now();
        
        if (now - lastScrollTime > 100) { // New scroll session
          scrollStartTime = now;
        }
        lastScrollTime = now;

        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          const endPos = { x: window.scrollX, y: window.scrollY };
          const distance = Math.round(Math.sqrt(
            Math.pow(endPos.x - lastScrollPos.x, 2) + 
            Math.pow(endPos.y - lastScrollPos.y, 2)
          ));

          if (distance > 10) {
            const direction = endPos.y > lastScrollPos.y ? 'DOWN' : 
                            endPos.y < lastScrollPos.y ? 'UP' : 
                            endPos.x > lastScrollPos.x ? 'RIGHT' : 'LEFT';

            const interactionData = {
              type: 'SCROLL',
              timestamp: now,
              direction,
              distance,
              duration: now - scrollStartTime,
              from: lastScrollPos,
              to: endPos,
              viewport: { 
                width: window.innerWidth, 
                height: window.innerHeight 
              }
            };
            
            console.log('[DEV3000_INTERACTION] ' + JSON.stringify(interactionData));
            lastScrollPos = endPos;
          }
        }, 150); // Wait for scroll to finish
      }, true);

      // Track form submissions
      document.addEventListener('submit', (event) => {
        const form = event.target;
        const formData = new FormData(form);
        const fields = {};
        
        for (const [key, value] of formData.entries()) {
          // Don't log actual values, just field names for privacy
          fields[key] = typeof value === 'string' ? \`<\${value.length} chars>\` : '<file>';
        }

        const interactionData = {
          type: 'FORM_SUBMIT',
          timestamp: Date.now(),
          target: {
            action: form.action || window.location.href,
            method: form.method || 'GET',
            fields: Object.keys(fields)
          }
        };
        
        console.log('[DEV3000_INTERACTION] ' + JSON.stringify(interactionData));
      }, true);

      console.log('[DEV3000_INTERACTION] CDP tracking initialized');
    `;

    await this.sendCDPCommand('Runtime.evaluate', {
      expression: trackingScript,
      includeCommandLineAPI: false
    });
  }

  private async takeScreenshot(event: string): Promise<string | null> {
    try {
      const result = await this.sendCDPCommand('Page.captureScreenshot', {
        format: 'png',
        quality: 80,
        clip: undefined, // Full viewport
        fromSurface: true
      });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${timestamp}-${event}.png`;
      const screenshotPath = `/tmp/dev3000-screenshot-${filename}`;
      
      // Save the base64 image
      const buffer = Buffer.from(result.data, 'base64');
      writeFileSync(screenshotPath, buffer);
      
      return filename;
    } catch (error) {
      this.logger('browser', `[CDP ERROR] Screenshot failed: ${error}`);
      return null;
    }
  }

  // Enhanced replay functionality using CDP
  async executeInteraction(interaction: any): Promise<void> {
    if (!this.connection) {
      throw new Error('No CDP connection available');
    }

    try {
      switch (interaction.type) {
        case 'CLICK':
          await this.sendCDPCommand('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: interaction.coordinates.x,
            y: interaction.coordinates.y,
            button: 'left',
            clickCount: 1
          });
          
          await this.sendCDPCommand('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: interaction.coordinates.x,
            y: interaction.coordinates.y,
            button: 'left',
            clickCount: 1
          });
          break;

        case 'KEYDOWN':
          await this.sendCDPCommand('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: interaction.key,
            code: interaction.code,
            ...interaction.modifiers
          });
          break;

        case 'SCROLL':
          await this.sendCDPCommand('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: interaction.to.x,
            y: interaction.to.y,
            deltaX: interaction.to.x - interaction.from.x,
            deltaY: interaction.to.y - interaction.from.y
          });
          break;

        default:
          this.logger('browser', `[REPLAY] Unknown interaction type: ${interaction.type}`);
      }
    } catch (error) {
      this.logger('browser', `[REPLAY ERROR] Failed to execute ${interaction.type}: ${error}`);
    }
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    // Close CDP connection
    if (this.connection) {
      this.connection.ws.close();
      this.connection = null;
    }

    // Close browser
    if (this.browser) {
      this.browser.kill('SIGTERM');
      
      // Force kill after 2 seconds if not closed
      setTimeout(() => {
        if (this.browser) {
          this.browser.kill('SIGKILL');
        }
      }, 2000);
      
      this.browser = null;
    }
  }
}