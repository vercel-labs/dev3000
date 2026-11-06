import { runSandboxCli } from "./sandbox-process.js"

/** Use the user's configured preference; never invent a sandbox identity. */
export async function configuredGitIdentity(
  run: typeof runSandboxCli = runSandboxCli,
  cwd = process.cwd(),
  signal?: AbortSignal
): Promise<Record<string, string> | undefined> {
  const [name, email] = await Promise.all(
    ["user.name", "user.email"].map((key) =>
      run("git", ["config", "--get", key], { cwd, signal, timeoutMs: 5000 })
        .then((value) => value.trim())
        .catch(() => "")
    )
  )
  if (!name || !email) return undefined
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email }
}

/** Make the effective identity discoverable to agents that inspect git config. */
export const sandboxGitIdentityScript = `
const {spawnSync} = require('node:child_process');
const [fallbackName, fallbackEmail] = process.argv.slice(1);
function git(args, optional = false) {
  const result = spawnSync('git', args, {encoding:'utf8'});
  if (optional && result.status === 1) return '';
  if (result.status !== 0) throw new Error('Git identity configuration failed: ' + (result.stderr || result.error?.message || result.status));
  return result.stdout.trim();
}
const name = git(['config','--get','user.name'], true) || fallbackName;
const email = git(['config','--get','user.email'], true) || fallbackEmail;
if (!name || !email) console.log('null');
else {
  // Preserve an explicit checkout preference; fill missing fields from the laptop.
  git(['config','--local','user.name',name]);
  git(['config','--local','user.email',email]);
  console.log(JSON.stringify({GIT_AUTHOR_NAME:name,GIT_AUTHOR_EMAIL:email,GIT_COMMITTER_NAME:name,GIT_COMMITTER_EMAIL:email}));
}
`

export async function configureSandboxGitIdentity(
  sandbox: {
    runCommand(options: { cmd: string; args: string[]; cwd: string }): Promise<{
      exitCode: number
      stdout(): Promise<string>
      stderr(): Promise<string>
    }>
  },
  workdir: string,
  identity?: Record<string, string>
): Promise<Record<string, string> | undefined> {
  const result = await sandbox.runCommand({
    cmd: "node",
    args: ["-e", sandboxGitIdentityScript, identity?.GIT_AUTHOR_NAME || "", identity?.GIT_AUTHOR_EMAIL || ""],
    cwd: workdir
  })
  if (result.exitCode !== 0) throw new Error(`Could not configure sandbox Git identity: ${await result.stderr()}`)
  return JSON.parse(await result.stdout()) || undefined
}
