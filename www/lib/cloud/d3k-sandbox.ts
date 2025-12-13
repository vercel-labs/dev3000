import { Sandbox } from "@vercel/sandbox"
import ms from "ms"

export interface D3kSandboxConfig {
  repoUrl: string
  branch?: string
  timeout?: string
  projectDir?: string
  framework?: string
  packageManager?: "pnpm" | "npm" | "yarn"
  devCommand?: string
  debug?: boolean
}

export interface D3kSandboxResult {
  sandbox: Sandbox
  devUrl: string
  mcpUrl: string
  projectName: string
  cleanup: () => Promise<void>
  // TODO: Add bypassToken support
  // The @vercel/sandbox SDK does not currently expose protection bypass tokens.
  // These tokens are needed for headless browser automation to access protected sandboxes.
  // Potential solutions:
  // 1. Extract from response headers (x-vercel-protection-bypass)
  // 2. Use Vercel API to get deployment protection bypass tokens
  // 3. Pass as environment variable if available
  // For now, workflows without bypass tokens will fail when accessing protected sandboxes.
  bypassToken?: string
}

/**
 * Create a Vercel Sandbox with d3k pre-configured and running
 *
 * This sets up a complete d3k environment in the cloud:
 * 1. Creates sandbox from git repo
 * 2. Installs project dependencies
 * 3. Installs d3k globally (pnpm i -g dev3000)
 * 4. Starts d3k (which auto-configures MCPs and starts browser)
 * 5. Returns sandbox with devUrl and mcpUrl
 *
 * The d3k MCP server will have all tools auto-configured:
 * - fix_my_app (with browser automation)
 * - nextjs-dev MCP tools
 * - chrome-devtools MCP tools
 */
export async function createD3kSandbox(config: D3kSandboxConfig): Promise<D3kSandboxResult> {
  const {
    repoUrl,
    branch = "main",
    timeout = "30m",
    projectDir = "",
    framework = "Next.js",
    packageManager = "pnpm",
    debug = false
  } = config

  const projectName = projectDir || repoUrl.split("/").pop()?.replace(".git", "") || "app"

  if (debug) {
    console.log("🚀 Creating d3k sandbox...")
    console.log(`  Repository: ${repoUrl}`)
    console.log(`  Branch/SHA: ${branch}${branch.length === 40 ? " (git commit SHA)" : " (branch name)"}`)
    console.log(`  Project: ${projectName}`)
    console.log(`  Framework: ${framework}`)
  }

  // Check for required credentials
  const token = process.env.VERCEL_TOKEN || process.env.VERCEL_OIDC_TOKEN
  if (!token) {
    throw new Error(
      "Missing VERCEL_TOKEN or VERCEL_OIDC_TOKEN environment variable. " +
        "Vercel AI Workflows should automatically provide VERCEL_OIDC_TOKEN. " +
        "Check your workflow configuration and ensure it has access to Vercel API credentials."
    )
  }

  if (debug) {
    console.log(`  Token type: ${process.env.VERCEL_OIDC_TOKEN ? "OIDC" : "static"}`)
  }

  // Helper function to run commands and collect output properly
  async function runCommandWithLogs(
    sandbox: Sandbox,
    options: Parameters<Sandbox["runCommand"]>[0]
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const result = await sandbox.runCommand(options)

    let stdout = ""
    let stderr = ""
    for await (const log of result.logs()) {
      if (log.stream === "stdout") {
        stdout += log.data
        if (debug && options.stdout !== process.stdout) console.log(log.data)
      } else {
        stderr += log.data
        if (debug && options.stderr !== process.stderr) console.debug(log.data)
      }
    }

    await result.wait()

    return {
      exitCode: result.exitCode,
      stdout,
      stderr
    }
  }

  // Create sandbox WITHOUT source parameter
  // We'll manually clone the repo after sandbox creation for better control
  // biome-ignore lint/suspicious/noExplicitAny: ms type inference issue
  const timeoutMs = ms(timeout as any) as unknown as number
  const sandbox = await Sandbox.create({
    resources: { vcpus: 8 },
    timeout: timeoutMs,
    ports: [3000, 3684], // App port + MCP server port
    runtime: "node22"
  })

  if (debug) console.log("  ✅ Sandbox created")

  try {
    const sandboxCwd = projectDir ? `/vercel/sandbox/${projectDir}` : "/vercel/sandbox"

    // Manually clone the repository
    if (debug) console.log(`  📦 Cloning repository: ${repoUrl}`)

    // Create the target directory
    const mkdirResult = await runCommandWithLogs(sandbox, {
      cmd: "mkdir",
      args: ["-p", sandboxCwd]
    })

    if (mkdirResult.exitCode !== 0) {
      throw new Error(`Failed to create directory ${sandboxCwd}: ${mkdirResult.stderr}`)
    }

    // Clone the repository
    const gitArgs = ["clone"]
    const repoUrlWithGit = repoUrl.endsWith(".git") ? repoUrl : `${repoUrl}.git`
    const isCommitSha = /^[0-9a-f]{40}$/i.test(branch)

    if (!isCommitSha) {
      // Shallow clone and target the requested branch when we're not pinning a commit
      gitArgs.push("--depth", "1")
      if (branch) {
        gitArgs.push("--branch", branch)
      }
    } else if (debug) {
      console.log("  ⚠️ Provided branch is a commit SHA - performing full clone to allow checkout")
    }

    gitArgs.push(repoUrlWithGit, sandboxCwd)

    const gitClone = await runCommandWithLogs(sandbox, {
      cmd: "git",
      args: gitArgs,
      env: {
        GIT_TERMINAL_PROMPT: "0"
      }
    })

    if (gitClone.exitCode !== 0) {
      throw new Error(`Git clone failed with exit code: ${gitClone.exitCode}. Error: ${gitClone.stderr}`)
    }

    // Ensure we are on the requested branch or commit (commit SHA requires checkout after full clone)
    if (branch) {
      if (debug) console.log(`  🔀 Checking out ref: ${branch}`)
      const gitCheckout = await runCommandWithLogs(sandbox, {
        cmd: "git",
        args: ["checkout", branch],
        cwd: sandboxCwd,
        env: {
          GIT_TERMINAL_PROMPT: "0"
        }
      })

      if (gitCheckout.exitCode !== 0) {
        throw new Error(`Git checkout failed with exit code: ${gitCheckout.exitCode}. Error: ${gitCheckout.stderr}`)
      }
    }

    if (debug) console.log("  ✅ Repository cloned")

    // Verify sandbox directory contents
    if (debug) console.log("  📂 Checking sandbox directory contents...")
    try {
      const lsResult = await runCommandWithLogs(sandbox, {
        cmd: "ls",
        args: ["-la", sandboxCwd]
      })
      if (lsResult.exitCode === 0) {
        console.log(`  📂 Contents of ${sandboxCwd}:`)
        console.log(lsResult.stdout)
      } else {
        console.log("  ⚠️ Could not read directory listing")
      }
    } catch (error) {
      console.log(`  ⚠️ Could not list directory: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Check for package.json
    if (debug) console.log("  📄 Verifying package.json exists...")
    try {
      const pkgCheck = await runCommandWithLogs(sandbox, {
        cmd: "test",
        args: ["-f", `${sandboxCwd}/package.json`]
      })
      if (pkgCheck.exitCode === 0) {
        console.log("  ✅ package.json found")
      } else {
        console.log("  ⚠️ WARNING: package.json not found in sandbox directory")
      }
    } catch (error) {
      console.log(`  ⚠️ Could not check for package.json: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Install project dependencies
    if (debug) console.log("  📦 Installing project dependencies...")
    const installResult = await runCommandWithLogs(sandbox, {
      cmd: packageManager,
      args: ["install"],
      cwd: sandboxCwd,
      stdout: debug ? process.stdout : undefined,
      stderr: debug ? process.stderr : undefined
    })

    if (installResult.exitCode !== 0) {
      throw new Error(`Project dependency installation failed with exit code ${installResult.exitCode}`)
    }

    if (debug) console.log("  ✅ Project dependencies installed")

    // Install system dependencies for Chromium
    // The Vercel Sandbox uses Amazon Linux 2023 which has dnf package manager
    // These packages provide shared libraries that Chromium needs (nspr, nss, etc.)
    if (debug) console.log("  🔧 Installing system dependencies for Chromium...")
    const sysDepsResult = await runCommandWithLogs(sandbox, {
      cmd: "sh",
      args: [
        "-c",
        "sudo dnf install -y nspr nss atk at-spi2-atk cups-libs libdrm libxkbcommon libXcomposite libXdamage libXfixes libXrandr mesa-libgbm alsa-lib cairo pango glib2 gtk3 libX11 libXext libXcursor libXi libXtst > /tmp/sys-deps-install.log 2>&1"
      ]
    })

    if (sysDepsResult.exitCode !== 0) {
      console.log(`  ⚠️ System dependencies installation failed (exit code ${sysDepsResult.exitCode})`)
      // Try to read the log for debugging
      try {
        const logResult = await runCommandWithLogs(sandbox, {
          cmd: "sh",
          args: ["-c", "cat /tmp/sys-deps-install.log 2>&1 | tail -20"]
        })
        if (logResult.stdout) {
          console.log(`  📋 Install log: ${logResult.stdout}`)
        }
      } catch {
        // Ignore log read errors
      }
      console.log("  ⚠️ Continuing anyway - browser automation may not work")
    } else {
      if (debug) console.log("  ✅ System dependencies installed")
    }

    // Install Chromium browser for headless browser automation using @sparticuz/chromium
    // The Vercel Sandbox doesn't have apt-get or Chrome installed by default
    // @sparticuz/chromium is designed for serverless environments and provides a pre-compiled Chromium
    if (debug) console.log("  🌐 Installing @sparticuz/chromium for serverless browser automation...")
    const chromiumInstallResult = await runCommandWithLogs(sandbox, {
      cmd: packageManager,
      args: ["add", "@sparticuz/chromium", "puppeteer-core"],
      cwd: sandboxCwd,
      stdout: debug ? process.stdout : undefined,
      stderr: debug ? process.stderr : undefined
    })

    if (chromiumInstallResult.exitCode !== 0) {
      console.log(`  ⚠️ @sparticuz/chromium installation failed (exit code ${chromiumInstallResult.exitCode})`)
      console.log("  ⚠️ Continuing anyway - d3k may work without browser automation")
    } else {
      if (debug) console.log("  ✅ @sparticuz/chromium installed")
    }

    // Create a helper script to extract the Chromium executable path from @sparticuz/chromium
    // This package downloads and extracts Chromium at runtime
    if (debug) console.log("  🔍 Getting Chromium executable path from @sparticuz/chromium...")
    const getChromiumPathResult = await runCommandWithLogs(sandbox, {
      cmd: "node",
      args: ["-e", "require('@sparticuz/chromium').executablePath().then(p => console.log(p))"],
      cwd: sandboxCwd
    })

    let chromiumPath = "/usr/bin/chromium" // fallback
    if (getChromiumPathResult.exitCode === 0 && getChromiumPathResult.stdout.trim()) {
      chromiumPath = getChromiumPathResult.stdout.trim()
      if (debug) console.log(`  ✅ Chromium path from @sparticuz/chromium: ${chromiumPath}`)
    } else {
      console.log(`  ⚠️ Could not get Chromium path from @sparticuz/chromium, using fallback: ${chromiumPath}`)
      if (getChromiumPathResult.stderr) {
        console.log(`  ⚠️ Error: ${getChromiumPathResult.stderr.substring(0, 500)}`)
      }
    }

    // CRITICAL TEST: Run Chrome CDP test in a single shell command
    // Previous tests showed that using separate commands can fail with 400 errors
    // if a command doesn't exist (like 'file'). So we do everything in one sh -c.
    console.log("  🔍 ===== CHROMIUM DIAGNOSTIC TEST =====")
    try {
      const chromeTest = await runCommandWithLogs(sandbox, {
        cmd: "sh",
        args: [
          "-c",
          `
          # Redirect stderr to stdout so we capture everything
          exec 2>&1

          echo "=== Chromium CDP Test ==="
          echo "Chromium path: ${chromiumPath}"
          echo ""

          echo "1. Checking if file exists..."
          ls -la "${chromiumPath}" 2>&1 || echo "   ❌ File not found"

          echo ""
          echo "2. Checking file type (if 'file' command exists)..."
          file "${chromiumPath}" 2>&1 || echo "   (file command not available)"

          echo ""
          echo "3. Testing --version..."
          "${chromiumPath}" --version 2>&1 || echo "   ❌ --version failed"

          echo ""
          echo "4. Starting Chrome headless with CDP port..."
          echo "   Command: ${chromiumPath} --headless=new --no-sandbox --disable-gpu --remote-debugging-port=9222 about:blank"

          # Start Chrome in background
          "${chromiumPath}" --headless=new --no-sandbox --disable-setuid-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 about:blank &
          PID=$!
          echo "   Chrome PID: $PID"

          # Wait 2 seconds
          sleep 2

          echo ""
          echo "5. Checking if Chrome is still running..."
          if ps -p $PID > /dev/null 2>&1; then
            echo "   ✅ Chrome is RUNNING after 2s"

            echo ""
            echo "6. Trying to connect to CDP endpoint..."
            curl -s --max-time 3 http://127.0.0.1:9222/json/version 2>&1 || echo "   ⚠️ CDP connection failed"

            echo ""
            echo "7. Killing test Chrome process..."
            kill $PID 2>/dev/null
          else
            echo "   ❌ Chrome DIED within 2s"
            wait $PID 2>/dev/null
            echo "   Exit code: $?"
          fi

          echo ""
          echo "8. Current processes:"
          ps aux 2>/dev/null | grep -E "chrom|PID" | head -10 || echo "   (ps failed)"

          echo ""
          echo "=== End Chromium CDP Test ==="
          `
        ]
      })
      console.log(`  📋 Chrome CDP test result (exit ${chromeTest.exitCode}):\n${chromeTest.stdout || "(no output)"}`)
      if (chromeTest.stderr) console.log(`  ⚠️ Chrome CDP test stderr: ${chromeTest.stderr}`)
    } catch (error) {
      console.log(`  ❌ Chrome CDP test failed with error: ${error instanceof Error ? error.message : String(error)}`)
    }
    console.log("  🔍 ===== END CHROMIUM DIAGNOSTIC TEST =====")

    // Install d3k globally from GitHub release (viewport fix for consistent CLS)
    // TODO: Revert to "dev3000" once v0.0.128 is published to npm
    const d3kTarballUrl =
      "https://github.com/vercel-labs/dev3000/releases/download/v0.0.127-canary-viewport2/dev3000-0.0.127-canary.tgz"
    if (debug) console.log(`  📦 Installing d3k globally from GitHub release: ${d3kTarballUrl}`)
    const d3kInstallResult = await runCommandWithLogs(sandbox, {
      cmd: "pnpm",
      args: ["i", "-g", d3kTarballUrl],
      stdout: debug ? process.stdout : undefined,
      stderr: debug ? process.stderr : undefined
    })

    if (d3kInstallResult.exitCode !== 0) {
      throw new Error(`d3k installation failed with exit code ${d3kInstallResult.exitCode}`)
    }

    if (debug) console.log("  ✅ d3k installed globally")

    // Start d3k (which will auto-configure MCPs and start browser)
    if (debug) console.log("  🚀 Starting d3k...")
    if (debug) console.log(`  📂 Working directory: ${sandboxCwd}`)

    // Use chromium path from @sparticuz/chromium (or fallback)
    if (debug)
      console.log(
        `  🔧 Command: cd ${sandboxCwd} && MCP_SKIP_PERMISSIONS=true d3k --no-tui --debug --headless --browser ${chromiumPath}`
      )

    // DIAGNOSTIC: First test if spawn() with the chromium path works inside the sandbox
    // This isolates whether the issue is with d3k's spawn() vs shell commands
    console.log("  🔍 ===== TESTING spawn() with chromium directly =====")
    try {
      const spawnTestScript = `
        exec 2>&1
        echo "Testing if Node can spawn Chrome directly..."
        node -e "
          const { spawn } = require('child_process');
          const chromePath = '${chromiumPath}';
          const args = [
            '--remote-debugging-port=9222',
            '--user-data-dir=/tmp/spawn-test-profile',
            '--no-first-run',
            '--headless=new',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            'about:blank'
          ];
          console.log('Spawning:', chromePath, args.join(' '));
          const proc = spawn(chromePath, args, { stdio: 'pipe', detached: false });
          proc.on('error', (e) => console.log('SPAWN ERROR:', e.message));
          proc.stderr.on('data', (d) => console.log('STDERR:', d.toString().trim()));
          proc.stdout.on('data', (d) => console.log('STDOUT:', d.toString().trim()));
          setTimeout(() => {
            const running = proc.pid && !proc.killed;
            console.log('Chrome PID:', proc.pid, 'Running:', running);
            if (running) {
              require('http').get('http://localhost:9222/json/version', (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                  console.log('CDP Response:', data.substring(0, 200));
                  proc.kill();
                  process.exit(0);
                });
              }).on('error', (e) => {
                console.log('CDP Error:', e.message);
                proc.kill();
                process.exit(1);
              });
            } else {
              console.log('Chrome not running after spawn');
              process.exit(1);
            }
          }, 3000);
        "
      `
      const spawnTest = await runCommandWithLogs(sandbox, {
        cmd: "sh",
        args: ["-c", spawnTestScript]
      })
      console.log(`  📋 spawn() test result (exit ${spawnTest.exitCode}):\n${spawnTest.stdout || "(no output)"}`)
      if (spawnTest.stderr) console.log(`  ⚠️ spawn() test stderr: ${spawnTest.stderr}`)
    } catch (error) {
      console.log(`  ❌ spawn() test failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    console.log("  🔍 ===== END spawn() TEST =====")

    // Start d3k in detached mode with --headless flag
    // This tells d3k to launch Chrome in headless mode, which works in serverless environments
    // We explicitly pass --browser with the path from @sparticuz/chromium
    // Logs are written to /home/vercel-sandbox/.d3k/logs/ and can be read later.
    // IMPORTANT: Do NOT start infinite log streaming loops here - they prevent
    // the workflow step function from completing properly.
    // DIAGNOSTIC: Also capture stdout/stderr to d3k-startup.log for debugging
    const d3kStartupLog = "/home/vercel-sandbox/.d3k/logs/d3k-startup.log"
    await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `mkdir -p /home/vercel-sandbox/.d3k/logs && cd ${sandboxCwd} && MCP_SKIP_PERMISSIONS=true d3k --no-tui --debug --headless --browser ${chromiumPath} > ${d3kStartupLog} 2>&1`
      ],
      detached: true
    })

    if (debug) console.log("  ✅ d3k started in detached mode (headless)")

    // Give d3k a moment to start and create log files
    if (debug) console.log("  ⏳ Waiting for d3k to start...")
    await new Promise((resolve) => setTimeout(resolve, 5000))

    // Debug: Check d3k process and log files
    if (debug) {
      console.log("  🔍 Checking d3k process status...")
      const psCheck = await runCommandWithLogs(sandbox, {
        cmd: "sh",
        args: ["-c", "ps aux | grep -E '(d3k|pnpm|next)' | grep -v grep || echo 'No d3k/pnpm/next processes found'"]
      })
      console.log(`  📋 Process list:\n${psCheck.stdout}`)

      console.log("  🔍 Checking for d3k log files...")
      const logsCheck = await runCommandWithLogs(sandbox, {
        cmd: "sh",
        args: ["-c", "ls -lah /home/vercel-sandbox/.d3k/logs/ 2>/dev/null || echo 'No .d3k/logs directory found'"]
      })
      console.log(`  📋 Log files:\n${logsCheck.stdout}`)

      // Check ALL d3k log files for initial content
      const allLogsCheck = await runCommandWithLogs(sandbox, {
        cmd: "sh",
        args: [
          "-c",
          'for log in /home/vercel-sandbox/.d3k/logs/*.log; do [ -f "$log" ] && echo "=== $log ===" && head -50 "$log" || true; done 2>/dev/null || true'
        ]
      })
      console.log(`  📋 Initial log content:\n${allLogsCheck.stdout}`)
    }

    // Note: We do NOT start infinite log streaming loops here because they prevent
    // the workflow step function from completing. Logs are written to files and can
    // be read synchronously when needed (see checks above).

    // Wait for dev server to be ready
    if (debug) console.log("  ⏳ Waiting for dev server on port 3000...")
    try {
      await waitForServer(sandbox, 3000, 120000, debug) // 2 minutes for d3k to start everything
    } catch (error) {
      // If dev server didn't start, try to get diagnostic info
      console.log(`  ⚠️ Dev server failed to start: ${error instanceof Error ? error.message : String(error)}`)
      console.log("  🔍 Checking d3k logs for errors...")

      try {
        // d3k creates log files with pattern: {projectName}-{timestamp}.log
        // Use cat with wildcard to capture all log files
        const logsCheck = await runCommandWithLogs(sandbox, {
          cmd: "sh",
          args: ["-c", "cat /home/vercel-sandbox/.d3k/logs/*.log 2>/dev/null || echo 'No log files found'"]
        })
        if (logsCheck.exitCode === 0) {
          console.log("  📋 All d3k logs:")
          console.log(logsCheck.stdout)
        }
      } catch (logError) {
        console.log(`  ⚠️ Could not read d3k logs: ${logError instanceof Error ? logError.message : String(logError)}`)
      }

      throw error
    }

    const devUrl = sandbox.domain(3000)
    if (debug) console.log(`  ✅ Dev server ready: ${devUrl}`)

    // Wait for MCP server to be ready (d3k starts it automatically)
    if (debug) console.log("  ⏳ Waiting for MCP server...")
    await waitForServer(sandbox, 3684, 60000, debug)

    const mcpUrl = sandbox.domain(3684)
    if (debug) console.log(`  ✅ MCP server ready: ${mcpUrl}`)

    // Wait for CDP URL to be available (needed for chrome-devtools MCP)
    // This is more reliable than a fixed timeout because it actually waits for
    // d3k to connect to Chrome and write the CDP URL to the session file
    if (debug) console.log("  ⏳ Waiting for d3k to initialize Chrome and populate CDP URL...")
    const cdpUrl = await waitForCdpUrl(sandbox, 30000, debug) // 30 second timeout
    if (cdpUrl) {
      if (debug) console.log(`  ✅ CDP URL ready: ${cdpUrl}`)

      // CRITICAL: Wait for d3k to complete navigation to the app
      // d3k writes session info BEFORE navigating, so CDP URL being ready doesn't
      // mean the page has loaded. We need to wait for navigation to complete.
      if (debug) console.log("  ⏳ Waiting for d3k to complete page navigation...")
      await waitForPageNavigation(sandbox, 30000, debug)
    } else {
      console.log("  ⚠️ CDP URL not found - chrome-devtools MCP features may not work")
      // DIAGNOSTIC: Dump all logs immediately when CDP fails - this is critical for debugging
      console.log("  📋 === d3k LOG DUMP (CDP URL not found) ===")
      try {
        const cdpFailLogs = await runCommandWithLogs(sandbox, {
          cmd: "sh",
          args: [
            "-c",
            'for log in /home/vercel-sandbox/.d3k/logs/*.log; do [ -f "$log" ] && echo "\\n=== $log ===" && cat "$log" || true; done 2>/dev/null || echo "No log files found"'
          ]
        })
        console.log(cdpFailLogs.stdout)
      } catch (logErr) {
        console.log(`  ⚠️ Could not read logs: ${logErr instanceof Error ? logErr.message : String(logErr)}`)
      }
      console.log("  📋 === END d3k LOG DUMP ===")
    }

    // Dump ALL d3k logs after initialization for debugging
    // This is critical for understanding what d3k is doing in the sandbox
    if (debug) {
      console.log("  📋 === d3k FULL LOG DUMP (after initialization) ===")
      const fullLogsCheck = await runCommandWithLogs(sandbox, {
        cmd: "sh",
        args: [
          "-c",
          'for log in /home/vercel-sandbox/.d3k/logs/*.log; do [ -f "$log" ] && echo "\\n=== $log ===" && cat "$log" || true; done 2>/dev/null || echo "No log files found"'
        ]
      })
      console.log(fullLogsCheck.stdout)
      console.log("  📋 === END d3k LOG DUMP ===")
    }

    // Verify we can actually fetch the dev server URL
    console.log(`  🔍 Testing dev server accessibility at ${devUrl}...`)
    try {
      const testResponse = await fetch(devUrl, {
        method: "GET",
        redirect: "manual" // Don't follow redirects
      })
      console.log(`  ✅ Dev server responded with status: ${testResponse.status} ${testResponse.statusText}`)

      if (testResponse.status === 308 || testResponse.status === 401) {
        console.log(
          `  ℹ️ Dev server returned ${testResponse.status}, this is expected for protected deployments (use bypass token)`
        )
      }
    } catch (error) {
      console.log(`  ⚠️ WARNING: Could not fetch dev server: ${error instanceof Error ? error.message : String(error)}`)
    }

    if (debug) console.log("  ✅ d3k sandbox ready!")

    return {
      sandbox,
      devUrl,
      mcpUrl,
      projectName,
      // TODO: Implement bypass token extraction
      // The @vercel/sandbox SDK doesn't expose bypass tokens.
      // Until this is implemented, protected sandboxes will fail in headless browser automation.
      bypassToken: undefined,
      cleanup: async () => {
        if (debug) console.log("  🧹 Cleaning up sandbox...")
        await sandbox.stop()
        if (debug) console.log("  ✅ Sandbox stopped")
      }
    }
  } catch (error) {
    // Clean up on error
    try {
      await sandbox.stop()
    } catch {
      // Ignore cleanup errors
    }
    throw error
  }
}

/**
 * Wait for a port to become available on the sandbox
 */
async function waitForServer(sandbox: Sandbox, port: number, timeoutMs: number, debug = false): Promise<void> {
  const startTime = Date.now()
  const url = sandbox.domain(port)
  let lastError: string | undefined
  let lastStatus: number | undefined

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url, { method: "HEAD", redirect: "manual" })
      lastStatus = response.status

      if (debug && response.status !== lastStatus) {
        console.log(`  🔍 Port ${port} check: status ${response.status} ${response.statusText}`)
      }

      // Consider server ready if:
      // - 2xx (ok)
      // - 404 (server responding but route not found)
      // - 308 (redirect - sandbox protection)
      // - 401 (auth required - sandbox protection)
      if (response.ok || response.status === 404 || response.status === 308 || response.status === 401) {
        if (debug) console.log(`  ✅ Port ${port} is ready (status ${response.status})`)
        return
      }

      // Log unexpected status codes
      if (response.status >= 400 && response.status !== 404) {
        lastError = `HTTP ${response.status} ${response.statusText}`
        if (debug) console.log(`  ⚠️ Port ${port} returned ${lastError}`)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (lastError !== errorMsg) {
        lastError = errorMsg
        if (debug) console.log(`  ⚠️ Port ${port} check failed: ${errorMsg}`)
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(
    `Server on port ${port} did not become ready within ${timeoutMs}ms. ` +
      `Last status: ${lastStatus ?? "no response"}, Last error: ${lastError ?? "none"}`
  )
}

/**
 * Wait for d3k to populate the CDP URL in its session file
 * This is necessary because d3k writes the session file before Chrome is fully connected,
 * and we need the CDP URL to be available before calling MCP tools that use chrome-devtools.
 */
async function waitForCdpUrl(sandbox: Sandbox, timeoutMs: number, debug = false): Promise<string | null> {
  const startTime = Date.now()
  let cdpUrl: string | null = null

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Read the session files from ~/.d3k/ in the sandbox
      const cmdResult = await sandbox.runCommand({
        cmd: "sh",
        args: [
          "-c",
          'for f in /home/vercel-sandbox/.d3k/*.json; do [ -f "$f" ] && cat "$f" 2>/dev/null && echo ""; done'
        ]
      })

      // Collect logs from the command
      let stdout = ""
      for await (const log of cmdResult.logs()) {
        if (log.stream === "stdout") {
          stdout += log.data
        }
      }
      await cmdResult.wait()

      const result = { exitCode: cmdResult.exitCode, stdout }

      if (result.exitCode === 0 && result.stdout.trim()) {
        // Parse each JSON object (one per line)
        const lines = result.stdout.trim().split("\n")
        for (const line of lines) {
          if (line.trim().startsWith("{")) {
            try {
              const sessionData = JSON.parse(line)
              if (sessionData.cdpUrl?.startsWith("ws://")) {
                cdpUrl = sessionData.cdpUrl
                if (debug) {
                  console.log(`  ✅ CDP URL found: ${cdpUrl}`)
                }
                return cdpUrl
              }
            } catch {
              // Skip invalid JSON lines
            }
          }
        }
      }

      if (debug && (Date.now() - startTime) % 5000 < 1000) {
        console.log(`  ⏳ Waiting for CDP URL... (${Math.round((Date.now() - startTime) / 1000)}s)`)
      }
    } catch (error) {
      if (debug) {
        console.log(`  ⚠️ Error checking CDP URL: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  if (debug) {
    console.log(`  ⚠️ CDP URL not available after ${timeoutMs}ms - chrome-devtools MCP may not work`)
  }
  return null
}

/**
 * Wait for d3k to complete navigation to the app page
 * d3k logs "[CDP] Navigated to http://localhost:PORT" when navigation is initiated.
 * We look for evidence in logs that the page has started loading.
 */
async function waitForPageNavigation(sandbox: Sandbox, timeoutMs: number, debug = false): Promise<boolean> {
  const startTime = Date.now()

  // Helper function to run commands and collect output
  async function runCommandWithLogs(
    sandbox: Sandbox,
    options: Parameters<Sandbox["runCommand"]>[0]
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const result = await sandbox.runCommand(options)
    let stdout = ""
    let stderr = ""
    for await (const log of result.logs()) {
      if (log.stream === "stdout") {
        stdout += log.data
      } else {
        stderr += log.data
      }
    }
    await result.wait()
    return { exitCode: result.exitCode, stdout, stderr }
  }

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Check d3k logs for evidence of navigation
      // d3k logs "[CDP] Navigated to http://localhost:PORT" after Page.navigate
      const logsResult = await runCommandWithLogs(sandbox, {
        cmd: "sh",
        args: [
          "-c",
          'grep -r "Navigated to http://localhost" /home/vercel-sandbox/.d3k/logs/*.log 2>/dev/null | head -1 || true'
        ]
      })

      if (logsResult.stdout.includes("Navigated to http://localhost")) {
        if (debug) {
          console.log(`  ✅ d3k has navigated to the app (detected in logs)`)
        }

        // Wait an additional 3 seconds for the page to fully load and settle
        // This gives time for JavaScript to execute and CLS metrics to be captured
        if (debug) {
          console.log(`  ⏳ Waiting 3 more seconds for page to fully load...`)
        }
        await new Promise((resolve) => setTimeout(resolve, 3000))

        return true
      }

      if (debug && (Date.now() - startTime) % 5000 < 1000) {
        console.log(`  ⏳ Waiting for page navigation... (${Math.round((Date.now() - startTime) / 1000)}s)`)
      }
    } catch (error) {
      if (debug) {
        console.log(`  ⚠️ Error checking for navigation: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  // If we didn't detect navigation in logs, still wait a bit as a fallback
  // The page might have loaded but logging might not have captured it
  if (debug) {
    console.log(`  ⚠️ Did not detect navigation in logs after ${timeoutMs}ms, waiting 5s as fallback...`)
  }
  await new Promise((resolve) => setTimeout(resolve, 5000))
  return false
}
