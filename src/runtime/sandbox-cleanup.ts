import type { Sandbox } from "@vercel/sandbox"
import { SANDBOX_AGENT_DIRECTORY, SANDBOX_TOOLS } from "./sandbox-agent.js"
import { sandboxFxContext } from "./sandbox-context.js"

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
        ? sandbox.runCommand({
            cmd: "node",
            args: [`${SANDBOX_TOOLS}/node_modules/dev3000/dist/runtime/cli.js`, "stop"],
            cwd: options.remoteWorkdir,
            timeoutMs: 4000,
            signal
          })
        : undefined
    ])
    if (options.ownsSandbox)
      await sandbox.stop({ signal: AbortSignal.timeout(8000) }).catch(() => {
        options.log(`Could not stop sandbox ${sandbox.name}; stop it with vercel sandbox stop`)
      })
    else if (options.originalPorts)
      await sandbox.update({ ports: options.originalPorts }, { signal: AbortSignal.timeout(5000) }).catch(() => {
        options.log("Could not restore attached sandbox ports")
      })
  }
  const waiting = setTimeout(() => options.log("Still closing the browser and sandbox session…"), 2000)
  waiting.unref()
  try {
    await Promise.allSettled([options.closeProxy?.(), options.closeBrowser?.(), remote()])
  } finally {
    clearTimeout(waiting)
  }
}
