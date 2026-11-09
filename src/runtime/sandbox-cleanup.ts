import type { Sandbox } from "@vercel/sandbox"
import { SANDBOX_AGENT_DIRECTORY, SANDBOX_TOOLS } from "./sandbox-agent.js"
import { sandboxFxContext } from "./sandbox-context.js"
import { SANDBOX_APP_PORT } from "./sandbox-ports.js"

/** Close independent local resources together; remote cleanup shares one deadline. */
export async function closeSandboxResources(options: {
  closeProxy?: () => Promise<void>
  closeBrowser?: () => Promise<void>
  sandbox?: Sandbox
  ownsSandbox: boolean
  fxContextInstalled: boolean
  remoteStarted: boolean
  remoteWorkdir: string
  originalPorts?: number[]
  log: (message: string) => void
}): Promise<void> {
  const remote = async () => {
    const sandbox = options.sandbox
    if (!sandbox) return
    const signal = AbortSignal.timeout(5000)
    let runtimeStopped = !options.remoteStarted
    await Promise.allSettled([
      options.fxContextInstalled
        ? sandboxFxContext(sandbox, undefined, signal).catch(() =>
            options.log("Could not remove the sandbox fx browser context")
          )
        : undefined,
      sandbox.runCommand({
        cmd: "rm",
        args: ["-rf", `${SANDBOX_AGENT_DIRECTORY}/gateway.json`, `${SANDBOX_TOOLS}/harness-context`],
        timeoutMs: 4000,
        signal
      }),
      // Stopping owned compute also stops its runtime. Attached compute must stay running.
      !options.ownsSandbox && options.remoteStarted
        ? sandbox
            .runCommand({
              cmd: "node",
              args: [`${SANDBOX_TOOLS}/node_modules/dev3000/dist/runtime/cli.js`, "stop"],
              cwd: options.remoteWorkdir,
              timeoutMs: 4000,
              signal
            })
            .then((result) => {
              runtimeStopped = result.exitCode === 0
            })
        : undefined
    ])
    if (options.ownsSandbox)
      await sandbox.stop({ signal: AbortSignal.timeout(8000) }).catch(() => {
        options.log(`Could not stop sandbox ${sandbox.name}; stop it with vercel sandbox stop`)
      })
    else if (options.originalPorts) {
      // Legacy sessions exposed 3000 as the proxy. Never re-expose the new app
      // listener if stopping an attached runtime failed or timed out.
      if (runtimeStopped && options.remoteStarted && options.originalPorts.includes(SANDBOX_APP_PORT)) {
        // /stop acknowledges before asynchronous shutdown finishes. Verify the
        // app has released its listener before restoring a public legacy route.
        const idle = await sandbox
          .runCommand({
            cmd: "node",
            args: [
              "-e",
              `const net=require('node:net');const deadline=Date.now()+3000;function check(){const s=net.createServer();s.once('error',()=>Date.now()<deadline?setTimeout(check,100):process.exit(1));s.listen(${SANDBOX_APP_PORT},'0.0.0.0',()=>s.close(()=>process.exit(0)));}check();`
            ],
            timeoutMs: 4000,
            signal: AbortSignal.timeout(4500)
          })
          .catch(() => undefined)
        runtimeStopped = idle?.exitCode === 0
      }
      if (!runtimeStopped && options.originalPorts.includes(SANDBOX_APP_PORT))
        options.log(
          "Could not confirm runtime shutdown; keeping the app port private instead of restoring legacy routes"
        )
      else
        await sandbox.update({ ports: options.originalPorts }, { signal: AbortSignal.timeout(5000) }).catch(() => {
          options.log("Could not restore attached sandbox ports")
        })
    }
  }
  const waiting = setTimeout(() => options.log("Still closing the browser and sandbox session…"), 2000)
  waiting.unref()
  try {
    await Promise.allSettled([options.closeProxy?.(), options.closeBrowser?.(), remote()])
  } finally {
    clearTimeout(waiting)
  }
}
