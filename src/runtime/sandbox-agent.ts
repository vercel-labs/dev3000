import type { Sandbox } from "@vercel/sandbox"

export const SANDBOX_TOOLS = "/tmp/d3k-tools"
export const SANDBOX_AGENT_DIRECTORY = `${SANDBOX_TOOLS}/agent-session`
export const SANDBOX_AGENT_BIN = `${SANDBOX_TOOLS}/bin`

export interface GatewayCredential {
  apiKeyString: string
  apiKey: { id: string; teamId: string; purpose: string; expiresAt: number }
}

/** The credential never appears in shell arguments, the project tree, or the shell's environment. */
export function fxWrapper(binary: string, credentialPath = `${SANDBOX_AGENT_DIRECTORY}/gateway.json`): string {
  return `#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
let credential
try { credential = JSON.parse(readFileSync(${JSON.stringify(credentialPath)}, "utf8")) }
catch {
  console.error("No active d3k Gateway session. Reconnect with d3k --project to renew it.")
  process.exit(1)
}
if (Date.now() >= credential.expiresAt) {
  console.error("The d3k Gateway session expired. Reconnect with d3k --project to renew it.")
  process.exit(1)
}
const env = { ...process.env, FX_PROVIDER: "gateway", AI_GATEWAY_API_KEY: credential.key }
delete env.VERCEL_OIDC_TOKEN
const child = spawnSync(${JSON.stringify(binary)}, process.argv.slice(2), { stdio: "inherit", env })
if (child.error) console.error("Could not start the sandbox fx binary")
process.exit(child.status ?? 1)
`
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
  return binary
}

export async function configureSandboxFx(
  sandbox: Sandbox,
  binary: string,
  workdir: string,
  credential: GatewayCredential
): Promise<void> {
  const directories = await sandbox.runCommand({
    cmd: "mkdir",
    args: ["-p", "-m", "700", SANDBOX_AGENT_DIRECTORY, SANDBOX_AGENT_BIN]
  })
  if (directories.exitCode !== 0) throw new Error("Could not prepare private fx configuration")
  // Explicitly secure an existing directory before uploading any credential.
  const secured = await sandbox.runCommand({ cmd: "chmod", args: ["700", SANDBOX_AGENT_DIRECTORY] })
  if (secured.exitCode !== 0) throw new Error("Could not secure fx configuration")
  await sandbox.writeFiles([
    {
      path: `${SANDBOX_AGENT_DIRECTORY}/gateway.json`,
      content: Buffer.from(JSON.stringify({ key: credential.apiKeyString, expiresAt: credential.apiKey.expiresAt }))
    },
    { path: `${SANDBOX_AGENT_BIN}/fx`, content: Buffer.from(fxWrapper(binary)) }
  ])
  const configured = await sandbox.runCommand({
    cmd: "node",
    args: [
      "--input-type=module",
      "-e",
      `import { chmodSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
chmodSync(${JSON.stringify(`${SANDBOX_AGENT_DIRECTORY}/gateway.json`)}, 0o600);
chmodSync(${JSON.stringify(`${SANDBOX_AGENT_BIN}/fx`)}, 0o755);
const directory = join(homedir(), ".fx");
mkdirSync(directory, { recursive: true, mode: 0o700 });
const path = join(directory, "settings.json");
const settings = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
settings.workspaces ??= {};
const workspace = settings.workspaces[process.argv[1]] ??= {};
workspace.credential_source = "ai_gateway_api_key";
writeFileSync(path, JSON.stringify(settings), { mode: 0o600 });`,
      workdir
    ]
  })
  if (configured.exitCode !== 0) throw new Error("Could not configure fx to use this session's Gateway key")
}
