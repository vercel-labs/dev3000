import type { Sandbox } from "@vercel/sandbox"
import { harnessStartupContext, type SandboxHarnessContext } from "./harness.js"

// fx loads ~/.fx/AGENTS.md at startup, whereas --add-dir exposes skills only
// for optional discovery. Preload the connected skill outside the project repo.
export const sandboxFxContextScript = `
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const directory = path.join(os.homedir(), '.fx');
const file = path.join(directory, 'AGENTS.md');
const start = '\\n<!-- d3k-browser-context:start -->\\n';
const end = '\\n<!-- d3k-browser-context:end -->\\n';
const mode = process.argv[1];
let current = '';
try {
  if (!fs.lstatSync(file).isFile()) throw new Error('Sandbox fx instructions must be a regular file');
  current = fs.readFileSync(file, 'utf8');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
let body = current;
const begin = body.indexOf(start);
if (begin !== -1) {
  const finish = body.indexOf(end, begin + start.length);
  if (finish === -1) throw new Error('Incomplete d3k browser context block');
  body = body.slice(0, begin) + body.slice(finish + end.length);
}
if (mode === 'install') body += start + process.argv[2] + end;
else if (mode !== 'remove') throw new Error('Unknown browser context operation');
if (body !== current) {
  fs.mkdirSync(directory, { recursive: true });
  if (body.length === 0) fs.unlinkSync(file);
  else fs.writeFileSync(file, body, { mode: 0o600 });
}
`

export async function sandboxFxContext(
  sandbox: Sandbox,
  context?: SandboxHarnessContext,
  signal?: AbortSignal
): Promise<void> {
  const note = context ? harnessStartupContext(context) : undefined
  const result = await sandbox.runCommand({
    cmd: "node",
    args: ["-e", sandboxFxContextScript, note ? "install" : "remove", ...(note ? [note] : [])],
    timeoutMs: 5000,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000)
  })
  if (result.exitCode !== 0) throw new Error("Could not update sandbox fx browser context")
}
