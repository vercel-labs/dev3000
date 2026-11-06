import { createHash } from "node:crypto"

export function eveBuildFingerprint(files) {
  const hash = createHash("sha256")
  for (const { path, content } of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const bytes = Buffer.from(content)
    hash.update(JSON.stringify([path, bytes.length])).update(bytes)
  }
  return hash.digest("hex")
}

// The marker is written only after install and build both succeed.
export const eveBuildCacheProbe = `
const fs = require('node:fs');
const expected = process.argv[1];
process.exit(fs.existsSync('node_modules/eve/bin/eve.js') && fs.existsSync('.eve') &&
  fs.existsSync('.d3k-build.sha256') && fs.readFileSync('.d3k-build.sha256', 'utf8') === expected ? 0 : 10);
`
