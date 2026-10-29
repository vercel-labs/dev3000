import Link from "next/link"
import { GitHubLink } from "@/components/github-link"

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="doc-container flex items-center justify-between py-6">
        <Link href="/" className="font-mono font-semibold tracking-tight">
          d3k
        </Link>
        <nav className="flex items-center gap-6" aria-label="Main navigation">
          <Link href="/changelog" className="text-sm text-muted-foreground hover:text-foreground">
            Changelog
          </Link>
          <GitHubLink />
        </nav>
      </header>
      <main className="doc-container py-20 sm:py-32">
        <p className="text-sm text-muted-foreground">By Vercel Labs</p>
        <h1 className="mt-4 max-w-2xl text-4xl sm:text-5xl font-semibold tracking-tight text-balance">
          Your coding agent should see what your app is doing.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
          The d3k skill gives your agent a managed browser and one timeline of server output, browser errors, network
          requests, and interactions. Reproduce an issue, inspect the evidence, and try the fix.
        </p>
        <section className="mt-16" aria-labelledby="get-started">
          {/* biome-ignore lint/correctness/useUniqueElementIds: static page section anchor */}
          <h2 id="get-started" className="text-xl font-semibold">
            Add the skill
          </h2>
          <pre className="mt-4 overflow-x-auto rounded-md border border-border p-4 text-sm">
            <code>pnpm dlx skills add vercel-labs/dev3000 --skill d3k</code>
          </pre>
          <p className="mt-6 text-muted-foreground">Then ask your coding agent:</p>
          <blockquote className="mt-3 border-l border-border pl-4 text-lg">
            Use d3k to run this project and help me debug it.
          </blockquote>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Your agent starts the dev server and a project browser, keeps them running across edits, and reads the
            evidence it needs. Sign-in state stays in the browser profile.
          </p>
        </section>
        <section className="mt-20" aria-label="Launch a coding harness">
          <h2 className="text-xl font-semibold">Start with your harness</h2>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Prefer to start from your terminal? Install the CLI, then run your local app with a coding harness. d3k
            starts the server and browser before handing the terminal to the harness with d3k skill guidance.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-md border border-border p-4 text-sm">
            <code>{"pnpm add --global dev3000\nd3k portless setup\nd3k start --harness codex"}</code>
          </pre>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Choose <code>fx</code>, <code>codex</code>, or <code>claude</code> with <code>--harness</code>. Use an
            interactive terminal with the harness installed and signed in. Exiting the harness closes the session.
          </p>
        </section>
        <section className="mt-20" aria-label="Remote project with local Chrome">
          <h2 className="text-xl font-semibold">Remote code, local Chrome</h2>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Run your Vercel project and harness in a sandbox while Chrome uses your laptop’s CPU and GPU. No local
            project checkout is needed. A stable HTTPS URL and an authenticated browser bridge connect them.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-md border border-border p-4 text-sm">
            <code>
              {
                "vercel login\npnpm dlx agent-browser install\nd3k --project my-team/my-project --harness fx\n# Browser: https://my-project.d3k.localhost"
              }
            </code>
          </pre>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Sandbox mode is experimental and requires macOS, Vercel CLI, Sandbox access, Bun, Node.js 24+, Chrome, and
            local Portless setup. New sandboxes clone public repositories. Use <code>--attach my-dev</code> for an
            existing sandbox containing a private checkout. Chrome is confined to its dedicated profile and system
            files. Authenticate your harness inside the sandbox; d3k does not provision or forward Gateway keys.
          </p>
        </section>
        <section className="mt-20" aria-label="Resume a sandbox session">
          <h2 className="text-xl font-semibold">Exit and pick it back up</h2>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Exiting the sandbox harness or pressing Ctrl-C closes Chrome and prints your resume command. Resume restores
            the checkout, hostname, browser profile, and harness choice with a fresh browser connection.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-md border border-border p-4 text-sm">
            <code>
              {
                "d3k --resume              # List saved sandbox sessions\nd3k --resume <id>         # Reconnect a session\nd3k --resume <id> --harness codex"
              }
            </code>
          </pre>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Saved entries contain session metadata, not past terminal output. Resume requires the sandbox to still exist
            and does not restore the harness conversation. See the{" "}
            <a
              href="https://github.com/vercel-labs/dev3000#resume-a-sandbox"
              className="text-foreground underline underline-offset-4"
            >
              README
            </a>{" "}
            for command overrides and lifecycle details.
          </p>
        </section>
        <section className="mt-20 grid gap-8 sm:grid-cols-3" aria-label="How it works">
          <div>
            <h2 className="font-medium">One timeline</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Server output and browser events share an ordered timeline, with network request IDs and exception stacks.
            </p>
          </div>
          <div>
            <h2 className="font-medium">Evidence on demand</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Your agent reads what changed since the last interaction. Recent evidence stays in memory while the
              runtime runs.
            </p>
          </div>
          <div>
            <h2 className="font-medium">A browser you can use</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Test the app yourself or let your agent drive the same monitored browser, with a stable local HTTPS URL.
            </p>
          </div>
        </section>
      </main>
      <footer className="doc-container border-t border-border py-8 text-sm text-muted-foreground">
        <a href="https://github.com/vercel-labs/dev3000" className="hover:text-foreground">
          Built in the open at Vercel Labs
        </a>
      </footer>
    </div>
  )
}
