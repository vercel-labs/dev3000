import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/** Hash published inputs, not tar metadata or the shared canary version. */
export function distributionFingerprint(root: string): string {
  const hash = createHash("sha256")
  const visit = (relative: string) => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const name = join(relative, entry.name)
      if (entry.isDirectory()) visit(name)
      else if (entry.isFile())
        hash
          .update(name)
          .update("\0")
          .update(readFileSync(join(root, name)))
          .update("\0")
    }
  }
  hash.update(readFileSync(join(root, "package.json")))
  for (const directory of ["bin", "dist", "scripts/eve", "skills/d3k"]) visit(directory)
  return hash.digest("hex")
}

// Runs in the repository. Include workspace manifests and lockfiles, including
// uncommitted edits. Save only after a successful install, which can update locks.
export const dependencyCacheScript = `
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const [mode, marker, seed] = process.argv.slice(1);
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {encoding:'utf8'}).trim();
const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {cwd:root, encoding:'utf8'}).split('\\0').filter(Boolean))].sort();
const hash = createHash('sha256').update(seed).update(process.version).update(process.arch).update(process.platform);
for (const name of files) {
  if (!/^(package.json|bun.lockb?|package-lock.json|yarn.lock|pnpm-lock.yaml|pnpm-workspace.yaml|bunfig.toml|.npmrc)$/.test(path.basename(name))) continue;
  const file = path.join(root, name);
  if (fs.existsSync(file)) hash.update(name).update('\\0').update(fs.readFileSync(file)).update('\\0');
}
const fingerprint = hash.digest('hex');
if (mode === 'save') {
  fs.mkdirSync(path.dirname(marker), {recursive:true});
  fs.writeFileSync(marker, fingerprint);
} else {
  let directory = process.cwd();
  let installed = false;
  for (;;) {
    installed ||= fs.existsSync(path.join(directory, 'node_modules'));
    if (directory === root || directory === path.dirname(directory)) break;
    directory = path.dirname(directory);
  }
  process.exit(installed && fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === fingerprint ? 0 : 10);
}
`
