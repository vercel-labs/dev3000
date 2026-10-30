import type { Sandbox } from "@vercel/sandbox"

export const SANDBOX_TOOLS = "/tmp/d3k-tools"
export const SANDBOX_AGENT_DIRECTORY = `${SANDBOX_TOOLS}/agent-session`
export const SANDBOX_AGENT_BIN = `${SANDBOX_TOOLS}/bin`

export function sandboxFxLauncher(binary: string): string {
  return `#!/usr/bin/env node
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
let credential;
try { credential = JSON.parse(readFileSync(${JSON.stringify(`${SANDBOX_AGENT_DIRECTORY}/gateway.json`)}, 'utf8')); }
catch { console.error('d3k Gateway session ended. Exit and resume d3k to reconnect.'); process.exit(1); }
if (Date.now() >= credential.expiresAt) {
  console.error('d3k Gateway session expired. Exit and resume d3k to reconnect.'); process.exit(1);
}
const env = { ...process.env, FX_PROVIDER: 'gateway', AI_GATEWAY_API_KEY: credential.key };
delete env.VERCEL_OIDC_TOKEN;
delete env.VERCEL_TOKEN;
delete env.VERCEL_AUTH_TOKEN;
const child = spawnSync(${JSON.stringify(binary)}, process.argv.slice(2), { stdio: 'inherit', env });
if (child.error) { console.error('Could not start sandbox fx'); process.exit(1); }
process.exit(child.status ?? 1);
`
}

export async function configureSandboxFxGateway(
  sandbox: Sandbox,
  binary: string,
  credential: { key: string; expiresAt: number }
): Promise<void> {
  const directory = await sandbox.runCommand({ cmd: "mkdir", args: ["-p", SANDBOX_AGENT_DIRECTORY] })
  if (directory.exitCode !== 0) throw new Error("Could not prepare fx Gateway session")
  // Remove the plain binary symlink before writing the launcher, so the executable is never overwritten.
  const unlinked = await sandbox.runCommand({ cmd: "rm", args: ["-f", `${SANDBOX_AGENT_BIN}/fx`] })
  if (unlinked.exitCode !== 0) throw new Error("Could not prepare fx Gateway launcher")
  await sandbox.writeFiles([
    { path: `${SANDBOX_AGENT_DIRECTORY}/gateway.json`, content: Buffer.from(JSON.stringify(credential)), mode: 0o600 },
    { path: `${SANDBOX_AGENT_BIN}/fx`, content: Buffer.from(sandboxFxLauncher(binary)), mode: 0o700 }
  ])
}

export async function prepareSandboxFx(sandbox: Sandbox): Promise<string> {
  const result = await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      `set -eu
if ! command -v fx >/dev/null 2>&1; then
  curl -fsSL https://fx.sh/setup.sh -o ${SANDBOX_TOOLS}/fx-setup.sh
  FX_INSTALL_DIR=${SANDBOX_TOOLS}/fx-bin bash ${SANDBOX_TOOLS}/fx-setup.sh >/dev/null
  printf '%s\\n' ${SANDBOX_TOOLS}/fx-bin/fx
else
  command -v fx
fi`
    ],
    timeoutMs: 180000
  })
  const binary = (await result.stdout()).trim()
  if (result.exitCode !== 0 || !binary.startsWith("/") || binary.includes("\n"))
    throw new Error("Could not install/find fx in the sandbox; retry or use --no-fx")
  const directory = await sandbox.runCommand({ cmd: "mkdir", args: ["-p", SANDBOX_AGENT_BIN] })
  if (directory.exitCode !== 0) throw new Error("Could not prepare fx launcher directory")
  // Only the binary is linked; no credential file or wrapper is created.
  const linked = await sandbox.runCommand({
    cmd: "ln",
    args: ["-sf", binary, `${SANDBOX_AGENT_BIN}/fx`]
  })
  if (linked.exitCode !== 0) throw new Error("Could not prepare fx launcher")
  return binary
}
