import type { Sandbox } from "@vercel/sandbox"

export const SANDBOX_TOOLS = "/tmp/d3k-tools"
export const SANDBOX_AGENT_DIRECTORY = `${SANDBOX_TOOLS}/agent-session`
export const SANDBOX_AGENT_BIN = `${SANDBOX_TOOLS}/bin`

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
