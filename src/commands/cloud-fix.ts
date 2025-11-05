import { Sandbox } from "@vercel/sandbox"
import ms from "ms"
import { detectProject } from "../utils/project-detector.js"

export interface CloudFixOptions {
  debug?: boolean
  timeout?: string
}

/**
 * Parse Server-Sent Events (SSE) response
 */
async function parseSSEResponse(response: Response): Promise<string> {
  const text = await response.text()
  const lines = text.split("\n")
  let result = ""

  for (const line of lines) {
    if (line.startsWith("data: ")) {
      const data = line.slice(6) // Remove "data: " prefix
      if (data === "[DONE]") break
      try {
        const parsed = JSON.parse(data)
        // Accumulate the result from SSE chunks
        if (parsed.result?.content) {
          for (const content of parsed.result.content) {
            if (content.type === "text" && content.text) {
              result += content.text
            }
          }
        }
        // Or just return the full parsed object as JSON
        if (parsed.result) {
          return JSON.stringify(parsed.result, null, 2)
        }
      } catch {
        // Not JSON, just text data
        result += `${data}\n`
      }
    }
  }

  return result || text
}

/**
 * Cloud Fix Command
 *
 * Analyzes and fixes issues in a project using Vercel Sandbox + MCP tools
 */
export async function cloudFix(options: CloudFixOptions = {}): Promise<void> {
  const { debug = false, timeout = "30m" } = options

  console.log("🔍 Detecting project...")

  // Detect project information
  const project = await detectProject()

  console.log(`  Repository: ${project.repoUrl}`)
  console.log(`  Branch: ${project.branch}`)
  console.log(`  Framework: ${project.framework || "Unknown"}`)
  console.log(`  Dev command: ${project.packageManager} run ${project.devCommand}`)
  console.log()

  console.log("🚀 Creating Vercel Sandbox...")

  // Create sandbox
  // biome-ignore lint/suspicious/noExplicitAny: ms type inference issue
  const timeoutMs = ms(timeout as any) as unknown as number
  const sandbox = await Sandbox.create({
    source: {
      url: `${project.repoUrl}.git`,
      type: "git"
    },
    resources: { vcpus: 4 },
    timeout: timeoutMs,
    ports: [3000, 3684], // App port + MCP server port
    runtime: "node22"
  })

  console.log("  Sandbox created successfully")

  try {
    // Install dependencies
    console.log("  Installing dependencies...")
    const installCmd = project.packageManager === "pnpm" ? "pnpm" : project.packageManager
    const installResult = await sandbox.runCommand({
      cmd: installCmd,
      args: ["install"],
      stdout: debug ? process.stdout : undefined,
      stderr: debug ? process.stderr : undefined
    })

    if (installResult.exitCode !== 0) {
      throw new Error(`Dependency installation failed with exit code ${installResult.exitCode}`)
    }

    // Start dev server
    console.log("  Starting dev server...")
    await sandbox.runCommand({
      cmd: installCmd,
      args: ["run", project.devCommand],
      detached: true,
      stdout: debug ? process.stdout : undefined,
      stderr: debug ? process.stderr : undefined
    })

    // Wait for server to be ready
    console.log("  Waiting for dev server...")
    await waitForServer(sandbox, 3000, 60000)

    const devUrl = sandbox.domain(3000)
    console.log(`  ✅ Dev server ready: ${devUrl}`)
    console.log()

    // The dev server is already running - just report success
    console.log("✅ Development environment ready in sandbox!")
    console.log(`  Dev server: ${devUrl}`)
    console.log()

    // Verify site is accessible
    console.log("🔍 Verifying site accessibility...")
    try {
      const response = await fetch(devUrl)
      console.log(`  Status: ${response.status} ${response.statusText}`)
      console.log("  ✅ Site is accessible")
    } catch (err) {
      console.log(`  ⚠️  Error accessing site: ${err}`)
    }
    console.log()

    // Write session info file before starting MCP server
    console.log("📝 Writing session info...")
    const sessionScript = `
mkdir -p ~/.d3k
cat > ~/.d3k/${project.name}.json << 'EOF'
{
  "projectName": "${project.name}",
  "logFilePath": "/tmp/dev3000.log",
  "appPort": "3000",
  "mcpPort": "3684",
  "cdpUrl": null,
  "startTime": "${new Date().toISOString()}",
  "pid": $$,
  "cwd": "$(pwd)",
  "chromePids": [],
  "serverCommand": "${installCmd} run ${project.devCommand}",
  "framework": "nextjs"
}
EOF
`

    await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", sessionScript]
    })

    console.log(`  ✅ Session info written to ~/.d3k/${project.name}.json`)
    console.log()

    // Start MCP server in detached mode on port 3684
    console.log("🚀 Starting MCP server in sandbox...")
    await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", `cd mcp-server && PORT=3684 ${installCmd} run dev`],
      detached: true,
      stdout: debug ? process.stdout : undefined,
      stderr: debug ? process.stderr : undefined
    })

    // Wait for MCP server to be ready
    console.log("  Waiting for MCP server...")
    await waitForServer(sandbox, 3684, 30000)
    const mcpUrl = sandbox.domain(3684)
    console.log(`  ✅ MCP server ready: ${mcpUrl}`)
    console.log()

    // Install system dependencies for Chromium
    console.log("📦 Installing system dependencies for Chromium...")
    // Amazon Linux 2023 package names - comprehensive list for Chromium
    const sysDepsInstall = await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        "sudo dnf install -y nspr nss atk at-spi2-atk cups-libs libdrm libxkbcommon libXcomposite libXdamage libXfixes libXrandr mesa-libgbm alsa-lib cairo pango glib2 gtk3 libX11 libXext libXcursor libXi libXtst > /tmp/sys-deps-install.log 2>&1"
      ]
    })

    if (sysDepsInstall.exitCode !== 0) {
      console.log(`  ⚠️  System dependencies installation failed (exit code: ${sysDepsInstall.exitCode})`)
      const logResult = await sandbox.runCommand({
        cmd: "sh",
        args: ["-c", "cat /tmp/sys-deps-install.log 2>&1 || echo 'No log file'"]
      })
      const logContent = await logResult.stdout()
      console.log(`  ${logContent.split("\n").slice(-20).join("\n  ")}`)
    } else {
      console.log("  ✅ System dependencies installed")
    }

    // Install Chromium package for sandbox
    console.log("📦 Installing Chromium for sandbox...")
    console.log("  This may take 2-3 minutes to download Chromium...")

    // Install chromium and puppeteer-core packages
    // For pnpm workspaces, we need -w flag to install at workspace root
    const chromiumInstall = await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `${installCmd} ${installCmd === "pnpm" ? "add -w" : "install"} chromium@latest puppeteer-core@latest > /tmp/chromium-install.log 2>&1`
      ]
    })

    if (chromiumInstall.exitCode !== 0) {
      console.log(`  ⚠️  Chromium installation failed (exit code: ${chromiumInstall.exitCode})`)

      // Get the installation logs
      const logResult = await sandbox.runCommand({
        cmd: "sh",
        args: ["-c", "cat /tmp/chromium-install.log 2>&1 || echo 'No log file'"]
      })
      const logContent = await logResult.stdout()

      console.log("  Installation error log:")
      console.log(`  ${logContent.split("\n").slice(-30).join("\n  ")}`)
      console.log("\n  Browser launch will likely fail, but continuing...")
    } else {
      console.log("  ✅ Chromium installed")
    }
    console.log()

    // Launch browser and connect to dev server
    console.log("🌐 Launching headless browser with CDP...")
    const browserScript = `
import puppeteer from 'puppeteer-core';
import chromiumPkg from 'chromium';
import fs from 'fs';
import path from 'path';
import os from 'os';

(async () => {
  // Check Node.js version - CDP requires Node >=v22.12.0
  const nodeVersion = process.version;
  console.log('Node.js version:', nodeVersion);
  const versionMatch = nodeVersion.match(/^v(\\d+)\\.(\\d+)\\.(\\d+)/);
  if (versionMatch) {
    const [, major, minor] = versionMatch.map(Number);
    if (major < 22 || (major === 22 && minor < 12)) {
      console.error('❌ ERROR: Node.js version >= v22.12.0 is required for CDP support');
      console.error('   Current version:', nodeVersion);
      console.error('   CDP tools will not work correctly with older versions');
      process.exit(1);
    }
    console.log('✅ Node.js version meets CDP requirements (>= v22.12.0)');
  }

  console.log('Ensuring Chromium is installed...');
  // The chromium package may need to download the binary first
  await chromiumPkg.install();

  console.log('Getting Chromium executable path from chromium package...');
  const executablePath = chromiumPkg.path;
  console.log('Chromium path:', executablePath);

  if (!executablePath || typeof executablePath !== 'string') {
    throw new Error(\`Chromium executable path not found or invalid: \${executablePath}\`);
  }

  console.log('Launching browser with Puppeteer...');
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: executablePath,
    headless: true,
    ignoreHTTPSErrors: true,
  });

  console.log('Browser launched successfully');
  const page = await browser.newPage();

  // Get CDP endpoint - Puppeteer uses wsEndpoint()
  const cdpUrl = browser.wsEndpoint();
  console.log('CDP URL:', cdpUrl);

  // Write session info for MCP server
  const sessionDir = path.join(os.homedir(), '.d3k');
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  const sessionInfo = {
    projectName: '${project.name}',
    logFilePath: '/tmp/dev3000.log',
    appPort: '3000',
    mcpPort: '3684',
    cdpUrl: cdpUrl,
    startTime: new Date().toISOString(),
    pid: process.pid,
    cwd: process.cwd(),
    chromePids: [process.pid],
    serverCommand: 'pnpm run dev',
    framework: 'nextjs'
  };

  const sessionFile = path.join(sessionDir, '${project.name}.json');
  fs.writeFileSync(sessionFile, JSON.stringify(sessionInfo, null, 2));
  console.log('Session info written to', sessionFile);
  console.log('Session file contents:', JSON.stringify(sessionInfo, null, 2));

  // Navigate to dev server
  console.log('Navigating to ${devUrl}');
  try {
    await page.goto('${devUrl}', { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('✅ Successfully navigated to dev server');
  } catch (err) {
    console.error('⚠️  Navigation error:', err);
    // Continue anyway - page might have loaded
  }

  console.log('Browser ready, keeping connection open...');

  // Keep browser alive for 10 minutes
  await new Promise(resolve => setTimeout(resolve, 600000));

  await browser.close();
})().catch(err => {
  console.error('Browser error:', err);
  process.exit(1);
});
`

    // Write browser script to sandbox
    await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", `cat > browser.js << 'EOF'\n${browserScript}\nEOF`]
    })

    // Launch browser and redirect output to log file
    console.log("  Launching browser.js script...")
    await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "node browser.js > /tmp/browser.log 2>&1 &"]
    })

    // Give it a moment to start
    await new Promise((resolve) => setTimeout(resolve, 2000))

    console.log("  ✅ Browser process started")
    console.log(`  Browser should be navigating to: ${devUrl}`)
    console.log("  Waiting for MCP server to discover session...")
    console.log("  (MCP server retries every 2 seconds for up to 20 seconds)")

    // Wait longer for MCP server to discover the session via its retry mechanism
    // The MCP server checks for new sessions every 2 seconds, up to 10 retries (20s total)
    await new Promise((resolve) => setTimeout(resolve, 25000))

    // Check browser status (always show for debugging)
    console.log("  Checking browser status...")

    // Check if browser.js is running
    const nodeCheckResult = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "ps aux | grep 'node browser.js' | grep -v grep || echo 'No node browser.js process'"]
    })
    const nodeOut = await nodeCheckResult.stdout()
    console.log("  Node process:", nodeOut.trim() || "none")

    // Check browser logs
    const browserLogResult = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "head -50 /tmp/browser.log 2>&1 || echo 'No browser log yet'"]
    })
    const browserOut = await browserLogResult.stdout()
    console.log("  Browser output:")
    console.log(browserOut || "  (no output)")

    // Check for chrome processes
    const chromeCheckResult = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "ps aux | grep -i chrome | head -5 || echo 'No chrome process found'"]
    })
    const chromeOut = await chromeCheckResult.stdout()
    console.log("  Chrome processes:", chromeOut.trim() || "none")

    // Check session file
    const sessionCheckResult = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", `cat ~/.d3k/${project.name}.json 2>&1 || echo 'Session file not found'`]
    })
    const sessionOut = await sessionCheckResult.stdout()
    console.log("  Session file contents:")
    console.log(sessionOut || "  (not found)")

    console.log()

    // First list available tools to see what we have
    console.log("🔍 Listing available MCP tools...")
    try {
      const listResponse = await fetch(`${mcpUrl}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          method: "tools/list"
        })
      })

      if (listResponse.ok) {
        const listText = await parseSSEResponse(listResponse)
        if (debug) {
          console.log(`  tools/list response:`, listText.substring(0, 1000))
        }

        try {
          const listResult = JSON.parse(listText)
          if (listResult.tools) {
            console.log(`  ✅ Found ${listResult.tools.length} tools`)
            if (debug) {
              for (const tool of listResult.tools) {
                console.log(`    - ${tool.name}`)
              }
            }
          }
        } catch (err) {
          console.log(`  ⚠️  Could not parse tools list: ${err}`)
        }
      }
    } catch (err) {
      console.log(`  ⚠️  Error listing tools: ${err}`)
    }
    console.log()

    // Run crawl_app tool via MCP
    console.log("🔍 Running crawl_app tool...")
    try {
      // Call MCP tool endpoint to crawl the site
      const crawlResponse = await fetch(`${mcpUrl}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "crawl_app",
            arguments: {
              depth: 2
            }
          }
        })
      })

      if (debug) {
        console.log(`  Response status: ${crawlResponse.status}`)
        console.log(`  Response headers:`, Object.fromEntries(crawlResponse.headers.entries()))
      }

      if (crawlResponse.ok) {
        const responseText = await parseSSEResponse(crawlResponse)
        if (debug) {
          console.log(`  Response body:`, responseText.substring(0, 500))
        }

        console.log("  ✅ Crawl completed")
        console.log(`\n${responseText}\n`)
      } else {
        const errorText = await crawlResponse.text()
        console.log(`  ⚠️  Crawl failed: ${crawlResponse.status} - ${errorText}`)
      }
    } catch (err) {
      console.log(`  ⚠️  Error calling crawl tool: ${err}`)
    }
    console.log()

    // Run fix_my_app tool
    console.log("🔧 Running fix_my_app tool...")
    try {
      const fixResponse = await fetch(`${mcpUrl}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "fix_my_app",
            arguments: {}
          }
        })
      })

      if (debug) {
        console.log(`  Response status: ${fixResponse.status}`)
      }

      if (fixResponse.ok) {
        const responseText = await parseSSEResponse(fixResponse)
        if (debug) {
          console.log(`  Response body:`, responseText.substring(0, 500))
        }

        console.log("  ✅ Fix analysis completed")
        console.log(`\n${responseText}\n`)
      } else {
        const errorText = await fixResponse.text()
        console.log(`  ⚠️  Fix analysis failed: ${fixResponse.status} - ${errorText}`)
      }
    } catch (err) {
      console.log(`  ⚠️  Error calling fix tool: ${err}`)
    }
    console.log()

    // TODO: Extract changes and create PR
    console.log("📤 Next: Create pull request...")
    console.log("  (TODO: Extract changed files from sandbox and create PR)")
    console.log()

    console.log("✅ Analysis complete!")
    console.log(`\nYou can view the app at: ${devUrl}`)
    console.log(`MCP server at: ${mcpUrl}`)
  } finally {
    console.log("\n🧹 Cleaning up sandbox...")
    await sandbox.stop()
    console.log("✅ Sandbox stopped")
  }
}

/**
 * Wait for a port to become available on the sandbox
 */
async function waitForServer(sandbox: Sandbox, port: number, timeoutMs: number): Promise<void> {
  const startTime = Date.now()
  const url = sandbox.domain(port)

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url, { method: "HEAD" })
      if (response.ok || response.status === 404) {
        return
      }
    } catch {
      // Not ready yet
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`Server on port ${port} did not become ready within ${timeoutMs}ms`)
}
