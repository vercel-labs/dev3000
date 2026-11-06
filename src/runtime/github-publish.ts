import { execFileSync } from "node:child_process"

export type GithubApi = (method: string, path: string, body?: Record<string, unknown>) => Promise<unknown>
type Ref = { ref: string; object: { sha: string } }
type Pull = {
  number: number
  html_url: string
  head: { ref: string; repo?: { full_name: string } }
  base: { ref: string; repo?: { full_name: string } }
}
type Identity = { name: string; email: string; date: string }
type Commit = {
  message: string
  tree: string
  parents: string[]
  author: Identity
  committer: Identity
}
type TreeEntry = { path: string; mode: string; type: string; sha: string }
type ObjectToPublish = { sha: string; type: "blobs" | "trees" | "commits"; body: Record<string, unknown> }
const maxRequestBytes = 1024 * 1024 - 4096

function utf8(bytes: Buffer): string {
  const text = bytes.toString("utf8")
  if (!Buffer.from(text).equals(bytes)) throw new Error("GitHub publishing requires UTF-8 commit text and paths")
  return text
}

function identity(line: string): Identity {
  const match = /^(.*) <([^<>]*)> (-?\d+) ([+-])(\d{2})(\d{2})$/.exec(line)
  if (!match) throw new Error("Unsupported Git author/committer identity")
  const [, name, email, epoch, sign, hours, minutes] = match
  const offset = (Number(hours) * 60 + Number(minutes)) * (sign === "+" ? 1 : -1)
  // Keep the original offset, including -0000, rather than converting the commit to UTC.
  const localTime = new Date(Number(epoch) * 1000 + offset * 60000).toISOString().slice(0, 19)
  return { name, email, date: `${localTime}${sign}${hours}:${minutes}` }
}

/** Read the raw object: trimming or shell substitution would change the commit's SHA. */
export function parsePublishCommit(bytes: Buffer): Commit {
  const raw = utf8(bytes)
  const divider = raw.indexOf("\n\n")
  if (divider < 0) throw new Error("Invalid Git commit")
  const headers = raw.slice(0, divider).split("\n")
  if (!headers.every((line) => /^(tree|parent|author|committer) /.test(line)))
    throw new Error("Signed commits and extra Git headers require managed git push; no ref was changed")
  const values = (name: string) =>
    headers.filter((line) => line.startsWith(`${name} `)).map((s) => s.slice(name.length + 1))
  const one = (name: string) => {
    const matches = values(name)
    if (matches.length !== 1) throw new Error(`Expected one ${name} header`)
    return matches[0]
  }
  const parents = values("parent")
  if (parents.length !== 1) throw new Error("Publish supports linear feature commits; use managed git push for merges")
  const tree = one("tree")
  if (![tree, ...parents].every((sha) => /^[a-f0-9]{40}$/.test(sha)))
    throw new Error("Only SHA-1 Git objects are supported")
  return {
    message: raw.slice(divider + 2),
    tree,
    parents,
    author: identity(one("author")),
    committer: identity(one("committer"))
  }
}

function treeEntries(bytes: Buffer): TreeEntry[] {
  return utf8(bytes)
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const match = /^(\d{6}) (blob|tree|commit) ([a-f0-9]{40})\t([\s\S]+)$/.exec(record)
      if (!match) throw new Error("Unsupported Git tree entry")
      return { mode: match[1], type: match[2], sha: match[3], path: match[4] }
    })
}

/** Publish an already committed feature branch through the credential-free sandbox bridge. */
export async function publishGithub(options: {
  cwd: string
  base: string
  title: string
  body: string
  api: GithubApi
}) {
  const { cwd, base, title, body, api } = options
  const gitBytes = (...args: string[]) =>
    execFileSync("git", args, { cwd, maxBuffer: 16 * 1024 * 1024, timeout: 15000, stdio: ["pipe", "pipe", "pipe"] })
  const git = (...args: string[]) =>
    gitBytes(...args)
      .toString("utf8")
      .trim()
  const validBranch = (name: string) => {
    // Match the companion's repo-relative endpoint alphabet; prevent query/path injection.
    if (!/^[\w./-]+$/.test(name) || name.startsWith("-") || name.includes("..") || name.includes("//"))
      throw new Error(`Unsupported branch name: ${name}`)
    git("check-ref-format", "--branch", name)
  }
  validBranch(base)
  const branch = git("symbolic-ref", "--quiet", "--short", "HEAD")
  validBranch(branch)
  if (branch === base) throw new Error("Create and commit on a feature branch before publishing")
  if (!title.trim()) throw new Error("A PR title is required")
  const pullBody = { title, body, head: branch, base, draft: true }
  if (Buffer.byteLength(JSON.stringify({ method: "POST", path: "/pulls", body: pullBody })) > maxRequestBytes)
    throw new Error("PR title/description exceeds the publishing bridge's 1 MiB limit")
  const head = git("rev-parse", "HEAD")
  const remoteBase = (await api("GET", `/git/ref/heads/${base}`)) as Ref
  if (!/^[a-f0-9]{40}$/.test(remoteBase.object?.sha)) throw new Error("Invalid GitHub base ref")
  let ancestor: string | undefined
  let baseError: unknown
  for (const candidate of [remoteBase.object.sha, `refs/remotes/origin/${base}`, `refs/heads/${base}`]) {
    try {
      const shared = git("merge-base", candidate, head)
      // Main can advance while this sandbox is open. Its new tip need not exist
      // locally: confirm the older shared object exists on GitHub instead.
      if (candidate !== remoteBase.object.sha) {
        const remote = (await api("GET", `/git/commits/${shared}`)) as { sha: string }
        if (remote.sha !== shared) throw new Error("GitHub shared commit did not match")
      }
      ancestor = shared
      break
    } catch (error) {
      baseError = error
      // Try the checkout's saved base when GitHub's current tip is not local.
    }
  }
  if (!ancestor)
    throw new Error(
      `No shared base commit could be verified on GitHub. Update the base before publishing. ${String(baseError)}`
    )
  if (ancestor === head) throw new Error("No feature commits to publish")
  const commits = git("rev-list", "--reverse", "--topo-order", `${ancestor}..${head}`).split("\n")
  if (commits.length > 100) throw new Error("Publish supports up to 100 feature commits")

  const readBranch = async () => {
    const refs = (await api("GET", `/git/matching-refs/heads/${branch}`)) as Ref[]
    if (!Array.isArray(refs)) throw new Error("Invalid GitHub branch response")
    return refs.find((ref) => ref.ref === `refs/heads/${branch}`)?.object.sha
  }
  const readPull = async () => {
    for (let page = 1; page <= 100; page++) {
      const pulls = (await api("GET", `/pulls?state=open&per_page=100&page=${page}`)) as Pull[]
      if (!Array.isArray(pulls)) throw new Error("Invalid GitHub PR response")
      const found = pulls.find(
        (pull) =>
          pull.head.ref === branch &&
          pull.base.ref === base &&
          pull.head.repo?.full_name &&
          pull.head.repo.full_name === pull.base.repo?.full_name
      )
      if (found) return found
      if (pulls.length < 100) return undefined
    }
    throw new Error("Too many open PRs to safely check for an existing PR")
  }
  const assertFastForward = (sha: string | undefined) => {
    if (sha && sha !== head) {
      try {
        git("merge-base", "--is-ancestor", sha, head)
      } catch {
        throw new Error(`GitHub branch ${branch} has different history; refusing to overwrite it`)
      }
    }
  }
  const remoteHead = await readBranch()
  assertFastForward(remoteHead)
  const existingPull = await readPull()

  if (remoteHead !== head) {
    // Preflight every object before any write. Trees are sent whole, preserving deletions,
    // renames, executable modes, symlinks, submodules and file/directory replacements.
    const objects: ObjectToPublish[] = []
    const seen = new Set<string>()
    let totalBytes = 0
    const add = (object: ObjectToPublish) => {
      const bytes = Buffer.byteLength(
        JSON.stringify({ method: "POST", path: `/git/${object.type}`, body: object.body })
      )
      if (bytes > maxRequestBytes)
        throw new Error(`Git object ${object.sha} exceeds the publishing bridge's 1 MiB limit`)
      totalBytes += bytes
      if (totalBytes > 64 * 1024 * 1024 || objects.length >= 10000)
        throw new Error("Change exceeds the publishing bridge's 64 MiB / 10,000 object limit")
      objects.push(object)
    }
    // Objects reachable from the shared ancestor already exist on GitHub.
    const missing = new Set(git("rev-list", "--objects", "--no-object-names", `${ancestor}..${head}`).split("\n"))
    const tree = (sha: string) => {
      if (seen.has(sha) || !missing.has(sha)) return
      seen.add(sha)
      const entries = treeEntries(gitBytes("ls-tree", "-z", sha))
      for (const entry of entries) {
        if (entry.type === "tree") tree(entry.sha)
        else if (entry.type === "blob" && !seen.has(entry.sha) && missing.has(entry.sha)) {
          seen.add(entry.sha)
          if (Number(git("cat-file", "-s", entry.sha)) > 750000)
            throw new Error(`Blob ${entry.path} exceeds the publishing bridge's 1 MiB limit`)
          add({
            sha: entry.sha,
            type: "blobs",
            body: { content: gitBytes("cat-file", "blob", entry.sha).toString("base64"), encoding: "base64" }
          })
        }
      }
      add({ sha, type: "trees", body: { tree: entries } })
    }
    let parent = ancestor
    for (const sha of commits) {
      const commit = parsePublishCommit(gitBytes("cat-file", "commit", sha))
      if (commit.parents[0] !== parent) throw new Error("Feature history is not linear")
      tree(commit.tree)
      add({ sha, type: "commits", body: { ...commit } })
      parent = sha
    }
    for (const object of objects) {
      const result = (await api("POST", `/git/${object.type}`, object.body)) as { sha: string }
      if (result.sha !== object.sha)
        throw new Error(
          `GitHub ${object.type} SHA mismatch for ${object.sha}: got ${result.sha}. No branch ref was changed; use managed git push for objects GitHub cannot preserve.`
        )
    }
    if (git("rev-parse", "HEAD") !== head || git("symbolic-ref", "--quiet", "--short", "HEAD") !== branch)
      throw new Error("Checkout changed during publishing; no branch ref was changed")
    // Recheck immediately before the ref write. GitHub also enforces fast-forward updates.
    const current = await readBranch()
    assertFastForward(current)
    if (current !== head) {
      try {
        if (current) await api("PATCH", `/git/refs/heads/${branch}`, { sha: head, force: false })
        else await api("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: head })
      } catch (error) {
        // A timeout can happen after success. Read state, never blindly replay the mutation.
        if ((await readBranch()) !== head) throw error
      }
    }
    if ((await readBranch()) !== head) throw new Error("GitHub branch did not match the committed head")
  }
  let pull = existingPull ?? (await readPull())
  if (!pull) {
    try {
      pull = (await api("POST", "/pulls", pullBody)) as Pull
    } catch (error) {
      pull = await readPull()
      if (!pull) throw error
    }
  }
  if (!pull.html_url || !pull.number)
    throw new Error("GitHub returned no PR URL; rerun publish to inspect existing state")
  return { url: pull.html_url, number: pull.number, branch, base, sha: head }
}
