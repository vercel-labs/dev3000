import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { type GithubApi, parsePublishCommit, publishGithub } from "./github-publish.js"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "d3k-publish-"))
  roots.push(cwd)
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "A User",
    GIT_AUTHOR_EMAIL: "user@example.com",
    GIT_COMMITTER_NAME: "A User",
    GIT_COMMITTER_EMAIL: "user@example.com",
    GIT_AUTHOR_DATE: "1793942187 +0000",
    GIT_COMMITTER_DATE: "1793942187 +0000"
  }
  const git = (...args: string[]) => execFileSync("git", args, { cwd, env }).toString().trim()
  git("init", "-b", "main")
  writeFileSync(join(cwd, "old.txt"), "old content\n")
  git("add", "old.txt")
  git("-c", "commit.gpgsign=false", "commit", "-m", "base")
  const base = git("rev-parse", "HEAD")
  git("checkout", "-b", "codex/test")
  const commit = (message = "Update\n\nKeep the final newline.\n") => {
    git("add", "-A")
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-F", "-"], { cwd, env, input: message })
    return git("rev-parse", "HEAD")
  }
  const calls: { method: string; path: string; body?: Record<string, unknown> }[] = []
  const refs = new Map([["refs/heads/main", base]])
  const pulls: Record<string, unknown>[] = []
  const writeObject = (type: string, content: Buffer | string) =>
    execFileSync("git", ["hash-object", "-w", "-t", type, "--stdin"], { cwd, input: content }).toString().trim()
  const person = (role: string, input: unknown) => {
    const value = input as { name: string; email: string; date: string }
    const offset = value.date.slice(-6).replace(":", "")
    return `${role} ${value.name} <${value.email}> ${Date.parse(value.date) / 1000} ${offset}\n`
  }
  // Git itself hashes API-shaped requests. No canned expected SHAs: missing newlines,
  // wrong modes, binary corruption, or reordered objects cause the publisher to fail.
  const api: GithubApi = async (method, path, body) => {
    calls.push({ method, path, body })
    if (method === "GET" && path === "/git/ref/heads/main") return { object: { sha: base } }
    if (method === "GET" && path.startsWith("/git/matching-refs/"))
      return [...refs]
        .filter(([ref]) => ref.startsWith(`refs/${path.slice("/git/matching-refs/".length)}`))
        .map(([ref, sha]) => ({ ref, object: { sha } }))
    if (method === "GET" && path.startsWith("/pulls?")) return pulls
    if (method === "POST" && path === "/git/blobs")
      return { sha: writeObject("blob", Buffer.from(String(body?.content), "base64")) }
    if (method === "POST" && path === "/git/trees") {
      const entries = body?.tree as { mode: string; type: string; sha: string; path: string }[]
      const input = entries.map((entry) => `${entry.mode} ${entry.type} ${entry.sha}\t${entry.path}\0`).join("")
      return { sha: execFileSync("git", ["mktree", "--missing", "-z"], { cwd, input }).toString().trim() }
    }
    if (method === "POST" && path === "/git/commits") {
      const parents = ((body?.parents ?? []) as string[]).map((sha) => `parent ${sha}\n`).join("")
      const raw = `tree ${body?.tree}\n${parents}${person("author", body?.author)}${person("committer", body?.committer)}\n${body?.message}`
      return { sha: writeObject("commit", raw) }
    }
    if (method === "POST" && path === "/git/refs") {
      if (refs.has(String(body?.ref))) throw new Error("Ref exists")
      refs.set(String(body?.ref), String(body?.sha))
      return {}
    }
    if (method === "PATCH" && path.startsWith("/git/refs/")) {
      expect(body?.force).toBe(false)
      refs.set(`refs/${path.slice("/git/refs/".length)}`, String(body?.sha))
      return {}
    }
    if (method === "POST" && path === "/pulls") {
      const pull = {
        number: 42,
        html_url: "https://github.com/owner/project/pull/42",
        head: { ref: body?.head, repo: { full_name: "owner/project" } },
        base: { ref: body?.base, repo: { full_name: "owner/project" } }
      }
      expect(body?.draft).toBe(true)
      pulls.push(pull)
      return pull
    }
    throw new Error(`Unexpected ${method} ${path}`)
  }
  const publish = (override = api) =>
    publishGithub({ cwd, base: "main", title: "Improve page", body: "Checks passed.\n", api: override })
  return { cwd, git, env, base, commit, calls, refs, pulls, api, publish }
}

it("publishes exact multi-commit objects including binary, symlinks, modes, deletions and newlines; retries reuse the PR", async () => {
  const f = fixture()
  unlinkSync(join(f.cwd, "old.txt"))
  mkdirSync(join(f.cwd, "old.txt"))
  writeFileSync(join(f.cwd, "old.txt", "binary"), Buffer.from([0, 255, 128, 10]))
  writeFileSync(join(f.cwd, "script"), "#!/bin/sh\necho hi\n")
  chmodSync(join(f.cwd, "script"), 0o755)
  symlinkSync("script", join(f.cwd, "link"))
  f.commit()
  writeFileSync(join(f.cwd, "second"), "second change\n")
  const head = f.commit("Second change\n")
  writeFileSync(join(f.cwd, "untracked"), "do not publish")
  const result = await f.publish()
  expect(result).toMatchObject({ sha: head, number: 42, branch: "codex/test" })
  const commits = f.calls.filter((call) => call.path === "/git/commits")
  expect(commits).toHaveLength(2)
  expect(commits[0].body?.message).toBe("Update\n\nKeep the final newline.\n")
  expect(f.refs.get("refs/heads/codex/test")).toBe(head)
  expect(f.git("status", "--short")).toBe("?? untracked")
  f.calls.length = 0
  expect(await f.publish()).toEqual(result)
  expect(f.calls.every((call) => call.method === "GET")).toBe(true)
})

it("recovers ref and PR success after lost responses without repeating mutations", async () => {
  const f = fixture()
  writeFileSync(join(f.cwd, "old.txt"), "changed\n")
  f.commit()
  const result = await f.publish(async (method, path, body) => {
    const result = await f.api(method, path, body)
    if (method === "POST" && ["/git/refs", "/pulls"].includes(path)) throw new Error("Response lost")
    return result
  })
  expect(result.number).toBe(42)
  expect(f.calls.filter((call) => call.method === "POST" && call.path === "/pulls")).toHaveLength(1)
  expect(f.calls.filter((call) => call.method === "POST" && call.path === "/git/refs")).toHaveLength(1)
})

it("fast-forwards the same feature branch and reuses its open PR", async () => {
  const f = fixture()
  writeFileSync(join(f.cwd, "old.txt"), "first\n")
  f.commit()
  await f.publish()
  writeFileSync(join(f.cwd, "old.txt"), "second\n")
  const head = f.commit()
  await f.publish()
  expect(f.refs.get("refs/heads/codex/test")).toBe(head)
  expect(f.calls.filter((call) => call.method === "POST" && call.path === "/pulls")).toHaveLength(1)
  expect(f.calls.some((call) => call.method === "PATCH" && call.path === "/git/refs/heads/codex/test")).toBe(true)
})

it("refuses a different remote history before any writes", async () => {
  const f = fixture()
  writeFileSync(join(f.cwd, "old.txt"), "changed\n")
  f.commit()
  f.refs.set("refs/heads/codex/test", "a".repeat(40))
  await expect(f.publish()).rejects.toThrow("different history")
  expect(f.calls.every((call) => call.method === "GET")).toBe(true)
})

it("stops on an object SHA mismatch before publishing a ref or PR", async () => {
  const f = fixture()
  writeFileSync(join(f.cwd, "old.txt"), "changed\n")
  f.commit()
  await expect(
    f.publish(async (method, path, body) => {
      if (path === "/git/commits") return { sha: "a".repeat(40) }
      return f.api(method, path, body)
    })
  ).rejects.toThrow("SHA mismatch")
  expect(f.refs.has("refs/heads/codex/test")).toBe(false)
  expect(f.pulls).toHaveLength(0)
})

it("preflights oversized blobs before any writes", async () => {
  const f = fixture()
  writeFileSync(join(f.cwd, "large"), Buffer.alloc(800000))
  f.commit()
  await expect(f.publish()).rejects.toThrow("1 MiB limit")
  expect(f.calls.every((call) => call.method === "GET")).toBe(true)
})

it.each(["+0530", "-0800", "-0000"])("preserves author and committer epoch and original offset %s", (offset) => {
  const raw = `tree ${"1".repeat(40)}\nparent ${"2".repeat(40)}\nauthor A <a@b> 1793942187 ${offset}\ncommitter B <b@c> 1793942187 ${offset}\n\nMessage\n\n`
  const parsed = parsePublishCommit(Buffer.from(raw))
  expect(Date.parse(parsed.author.date) / 1000).toBe(1793942187)
  expect(parsed.author.date.slice(-6).replace(":", "")).toBe(offset)
  expect(parsed.message).toBe("Message\n\n")
})

it("rejects signed or extra-header commits before any writes", async () => {
  const f = fixture()
  writeFileSync(join(f.cwd, "old.txt"), "changed\n")
  const head = f.commit()
  const raw = execFileSync("git", ["cat-file", "commit", head], { cwd: f.cwd })
    .toString()
    .replace("\n\n", "\nencoding ISO-8859-1\n\n")
  const sha = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], { cwd: f.cwd, input: raw })
    .toString()
    .trim()
  f.git("update-ref", "HEAD", sha)
  await expect(f.publish()).rejects.toThrow("extra Git headers")
  expect(f.calls.every((call) => call.method === "GET")).toBe(true)
})

it("publishes when main advanced remotely after the sandbox was created", async () => {
  const f = fixture()
  writeFileSync(join(f.cwd, "old.txt"), "changed\n")
  const head = f.commit()
  let checkedOldBase = false
  const result = await f.publish(async (method, path, body) => {
    if (method === "GET" && path === "/git/ref/heads/main") return { object: { sha: "b".repeat(40) } }
    if (method === "GET" && path === `/git/commits/${f.base}`) {
      checkedOldBase = true
      return { sha: f.base }
    }
    return f.api(method, path, body)
  })
  expect(checkedOldBase).toBe(true)
  expect(result.sha).toBe(head)
})

it("does not mistake a fork's PR on a same-named branch for this repository's PR", async () => {
  const f = fixture()
  writeFileSync(join(f.cwd, "old.txt"), "changed\n")
  f.commit()
  f.pulls.push({
    number: 1,
    html_url: "https://github.com/owner/project/pull/1",
    head: { ref: "codex/test", repo: { full_name: "fork/project" } },
    base: { ref: "main", repo: { full_name: "owner/project" } }
  })
  expect((await f.publish()).number).toBe(42)
})
