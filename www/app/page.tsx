import { clsx } from "clsx"
import Image from "next/image"
import Link from "next/link"
import { GitHubLink } from "@/components/github-link"
import { Button } from "@/components/ui/button"
import HeroAppImage from "@/public/hero-app.png"
import HeroTerminalImage from "@/public/hero-terminal.png"
import { ChangelogLink, CurrentYear, TerminalRecording } from "./components.client"

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className={clsx("top-0 left-0 right-0 z-50 bg-background doc-container")}>
        <div className="container mx-auto py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-foreground rounded-md flex items-center justify-center">
                <span className="text-background font-mono font-bold text-xs">d3k</span>
              </div>
              <span
                className="font-semibold text-lg font-mono tracking-tighter"
                style={{
                  fontFeatureSettings: "ss09 off"
                }}
              >
                dev3000
              </span>
            </div>
            <nav className="flex items-center gap-4">
              {/* Reserve space so the GitHub link doesn't shift layout when it appears */}
              <div className="min-w-[92px] flex justify-end transition-all duration-300">
                <GitHubLink />
              </div>

              <ChangelogLink />
            </nav>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-8 max-w-2xl mx-auto">
        <div className="doc-container">
          <div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">By Vercel Labs</p>
              <h1 className="text-h1 font-semibold mb-3 text-balance">The AI-enabled browser for development</h1>
            </div>
            <p className="text-base text-muted-foreground leading-relaxed max-w-2xl text-pretty">
              Run your dev server through dev3000 to capture server logs, browser events, network requests, and
              screenshots in a unified timeline. Your coding agent gets complete context without you manually copying
              and pasting.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
            <Button size="lg" className="text-base" asChild>
              <a href="#quickstart">Get Started</a>
            </Button>
          </div>

          {/* Hero Screenshot */}
          <BleedContainer className="relative mt-16">
            <div className="relative isolate">
              <Image
                src={HeroTerminalImage}
                alt=""
                className="w-full"
                priority
                sizes="(max-width: 768px) 100vw, 940px"
                loading="eager"
              />
              <Image
                src={HeroAppImage}
                alt=""
                className="w-1/2 absolute -right-8 -bottom-8 drop-shadow-sm"
                priority
                sizes="(max-width: 768px) 100vw, 600px"
                loading="eager"
              />
            </div>
          </BleedContainer>

          <div className="border-t-[0.5px] mt-18 pt-8 border-gray-200 dark:border-gray-800 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] text-sm gap-3">
            <div className="space-y-2">
              <p className="font-medium">Server Logs</p>
              <p className="text-muted-foreground text-balance leading-relaxed">Timestamped server logs</p>
            </div>
            <div className="space-y-2">
              <p className="font-medium">Browser Events</p>
              <p className="text-muted-foreground text-balance leading-relaxed">Logs, errors & user interactions</p>
            </div>
            <div className="space-y-2">
              <p className="font-medium">Screenshots</p>
              <p className="text-muted-foreground text-balance leading-relaxed">Captured on errors & navigation</p>
            </div>
            <div className="space-y-2">
              <p className="font-medium">Network Requests</p>
              <p className="text-muted-foreground text-balance leading-relaxed">Complete HTTP requests & responses</p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-40">
        <div className="doc-container">
          {/** biome-ignore lint/correctness/useUniqueElementIds: page section IDs are intentionally static for navigation */}
          <h2 className="text-headline scroll-mt-8" id="quickstart">
            Quick Start
          </h2>

          <ol className="space-y-6 list-decimal list-inside">
            <li className="space-y-2 marker:tabular-nums">
              <span className="pl-2 font-medium">Install dev3000</span>
              <div className="pl-6 pt-2 space-y-3">
                <p className="text-muted-foreground">
                  For the best experience, install{" "}
                  <a href="https://github.com/tmux/tmux" className="underline underline-offset-2">
                    tmux
                  </a>{" "}
                  first:
                </p>
                <pre className="block w-full">
                  <code className="code-block">brew install tmux</code>
                </pre>
                <p className="text-muted-foreground">Then install dev3000:</p>
                <pre className="block w-full">
                  <code className="code-block">bun install -g dev3000</code>
                </pre>
                <p className="text-muted-foreground">npm and pnpm installs also work.</p>
              </div>
            </li>
            <li className="space-y-2 marker:tabular-nums">
              <span className="pl-2 font-medium">Start your dev server</span>
              <div className="pl-6 pt-2 space-y-2">
                <p className="text-muted-foreground">
                  Replaces your normal dev command. Starts your dev server & launches a monitored Chrome instance.
                </p>
                <pre className="block w-full">
                  <code className="code-block">
                    <span className="block code-comment"># Instead of running bun run dev</span>
                    <span className="block">
                      d3k <span className="code-comment"># or dev3000</span>
                    </span>
                    <span className="block h-[1lh]" />
                    <span className="block code-comment"># Setting a port</span>
                    <span className="block">d3k -p 5000</span>
                    <span className="block h-[1lh]" />
                    <span className="block code-comment"># Custom script</span>
                    <span className="block">d3k -s build-start</span>
                  </code>
                </pre>
              </div>
            </li>
            <li className="space-y-2 marker:tabular-nums">
              <span className="pl-2 font-medium">Use your app normally</span>
              <div className="pl-6 pt-2">
                <p className="text-muted-foreground">
                  Interact with your app in the monitored browser. Every log, request, error & page state is captured
                  automatically.
                </p>
              </div>
            </li>
            <li className="space-y-2 marker:tabular-nums">
              <span className="pl-2 font-medium">Ask your coding agent to debug</span>
              <div className="pl-6 pt-2 text-muted-foreground text-pretty">
                <p>Your agent sees everything: server output, client-side events & visual state at every step.</p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section className="pb-40">
        <div className="doc-container">
          <h2 className="text-headline">Skill Integrations</h2>

          <p className="text-base text-muted-foreground leading-relaxed max-w-2xl text-pretty">
            Works standalone or with skills installed via the skills CLI. d3k ships with a built‑in debugging skill and
            supports optional packs for Next.js, React performance, and design guidelines.
          </p>
        </div>
      </section>

      <section className="pb-40">
        <div className="doc-container">
          <h2 className="text-headline">Demo</h2>

          <BleedContainer>
            <TerminalRecording />
          </BleedContainer>

          <div className="border-t-[0.5px] mt-10 pt-8 border-gray-200 dark:border-gray-800 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] text-sm gap-3">
            <div className="space-y-2">
              <p className="font-medium">Server Logs</p>
              <p className="text-muted-foreground text-balance leading-relaxed">Timestamped server logs</p>
            </div>
            <div className="space-y-2">
              <p className="font-medium">Browser Events</p>
              <p className="text-muted-foreground text-balance leading-relaxed">Logs, errors & user interactions</p>
            </div>
            <div className="space-y-2">
              <p className="font-medium">Screenshots</p>
              <p className="text-muted-foreground text-balance leading-relaxed">Captured on errors & navigation</p>
            </div>
            <div className="space-y-2">
              <p className="font-medium">Network Requests</p>
              <p className="text-muted-foreground text-balance leading-relaxed">Complete HTTP requests & responses</p>
            </div>
          </div>
        </div>
      </section>

      <section className="pb-40">
        <div className="doc-container">
          <h2 className="text-headline">Frequently Asked Questions</h2>

          {FAQs.map((faq) => (
            <div key={faq.question}>
              <h3 className="font-medium mb-2">{faq.question}</h3>
              <p className="text-muted-foreground leading-normal">{faq.answer}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="doc-container relative pb-16 text-sm font-mono">
        <VercelWordmarkSVG />

        <section className="flex flex-col gap-1 *:hover:underline *:w-fit">
          <Link href="/changelog">Changelog</Link>
          <a href="https://github.com/vercel-labs/dev3000">GitHub</a>
          <a href="https://github.com/elsigh">Made by elsigh</a>
        </section>

        <p>
          © <CurrentYear /> Vercel
        </p>
      </footer>
    </div>
  )
}

const VercelWordmarkSVG = () => {
  return (
    <svg
      aria-label="Vercel logotype"
      role="img"
      viewBox="0 0 262 52"
      xmlns="http://www.w3.org/2000/svg"
      className="h-5"
    >
      <path
        d="M59.8019 52L29.9019 0L0.00190544 52H59.8019ZM89.9593 49.6328L114.947 2.36365H104.139L86.9018 36.6921L69.6647 2.36365H58.8564L83.8442 49.6328H89.9593ZM260.25 2.36365V49.6329H251.302V2.36365H260.25ZM210.442 31.99C210.442 28.3062 211.211 25.0661 212.749 22.2699C214.287 19.4737 216.431 17.321 219.181 15.812C221.93 14.3029 225.146 13.5484 228.828 13.5484C232.09 13.5484 235.026 14.2585 237.636 15.6788C240.245 17.0991 242.319 19.2074 243.857 22.0036C245.395 24.7998 246.187 28.2174 246.234 32.2564V34.3202H219.88C220.066 37.2496 220.928 39.5576 222.466 41.2442C224.051 42.8864 226.171 43.7075 228.828 43.7075C230.505 43.7075 232.043 43.2637 233.441 42.376C234.839 41.4883 235.888 40.2899 236.587 38.7808L245.745 39.4466C244.626 42.7754 242.529 45.4385 239.453 47.4358C236.377 49.4331 232.835 50.4317 228.828 50.4317C225.146 50.4317 221.93 49.6772 219.181 48.1681C216.431 46.6591 214.287 44.5064 212.749 41.7102C211.211 38.914 210.442 35.6739 210.442 31.99ZM237.006 28.6612C236.68 25.7762 235.771 23.668 234.28 22.3365C232.789 20.9606 230.971 20.2726 228.828 20.2726C226.358 20.2726 224.354 21.0049 222.816 22.4696C221.278 23.9343 220.322 25.9982 219.95 28.6612H237.006ZM195.347 22.3365C196.838 23.5348 197.77 25.1993 198.143 27.3297L207.371 26.8637C207.044 24.1562 206.089 21.8039 204.505 19.8066C202.92 17.8093 200.869 16.278 198.353 15.2128C195.883 14.1032 193.157 13.5484 190.174 13.5484C186.492 13.5484 183.277 14.3029 180.527 15.812C177.777 17.321 175.634 19.4737 174.096 22.2699C172.558 25.0661 171.789 28.3062 171.789 31.99C171.789 35.6739 172.558 38.914 174.096 41.7102C175.634 44.5064 177.777 46.6591 180.527 48.1681C183.277 49.6772 186.492 50.4317 190.174 50.4317C193.25 50.4317 196.046 49.8769 198.563 48.7673C201.079 47.6133 203.13 45.9933 204.714 43.9072C206.299 41.8212 207.254 39.38 207.58 36.5838L198.283 36.1844C197.957 38.5367 197.048 40.3565 195.557 41.6436C194.065 42.8864 192.271 43.5078 190.174 43.5078C187.285 43.5078 185.048 42.5091 183.463 40.5118C181.879 38.5145 181.086 35.6739 181.086 31.99C181.086 28.3062 181.879 25.4656 183.463 23.4683C185.048 21.471 187.285 20.4723 190.174 20.4723C192.178 20.4723 193.902 21.0937 195.347 22.3365ZM149.955 14.3457H158.281L158.522 21.1369C159.113 19.2146 159.935 17.7218 160.988 16.6585C162.514 15.1166 164.642 14.3457 167.371 14.3457H170.771V21.6146H167.302C165.359 21.6146 163.763 21.8789 162.514 22.4075C161.311 22.9362 160.386 23.7732 159.739 24.9186C159.137 26.064 158.837 27.5178 158.837 29.2799V49.6328H149.955V14.3457ZM111.548 22.2699C110.01 25.0661 109.241 28.3062 109.241 31.99C109.241 35.6739 110.01 38.914 111.548 41.7102C113.086 44.5064 115.229 46.6591 117.979 48.1681C120.729 49.6772 123.944 50.4317 127.626 50.4317C131.634 50.4317 135.176 49.4331 138.252 47.4358C141.327 45.4385 143.425 42.7754 144.543 39.4466L135.385 38.7808C134.686 40.2899 133.638 41.4883 132.24 42.376C130.842 43.2637 129.304 43.7075 127.626 43.7075C124.97 43.7075 122.849 42.8864 121.265 41.2442C119.727 39.5576 118.865 37.2496 118.678 34.3202H145.032V32.2564C144.986 28.2174 144.194 24.7998 142.656 22.0036C141.118 19.2074 139.044 17.0991 136.434 15.6788C133.824 14.2585 130.888 13.5484 127.626 13.5484C123.944 13.5484 120.729 14.3029 117.979 15.812C115.229 17.321 113.086 19.4737 111.548 22.2699ZM133.079 22.3365C134.57 23.668 135.479 25.7762 135.805 28.6612H118.748C119.121 25.9982 120.076 23.9343 121.614 22.4696C123.152 21.0049 125.156 20.2726 127.626 20.2726C129.77 20.2726 131.587 20.9606 133.079 22.3365Z"
        fill="currentColor"
      ></path>
    </svg>
  )
}

const FAQs: {
  question: string
  answer: React.ReactNode
}[] = [
  {
    question: "Which coding agents work with dev3000?",
    answer:
      "All of them. dev3000 works with any AI coding assistant that can read a skill file or follow CLI output—including Claude Code, Cursor, Windsurf, Codex, and others. It also works standalone in your terminal without any agent."
  },
  {
    question: "Does dev3000 persist browser state between sessions?",
    answer: "Yes. Each project gets a dedicated Chrome profile that preserves login state, cookies, and local storage."
  },
  {
    question: "Can I use Arc or another browser instead of Chrome?",
    answer: (
      <>
        Yes! Use the <code className="bg-muted px-2 py-1 rounded text-sm font-mono">--browser</code> flag with the path
        to any Chromium-based browser. For Arc:{" "}
        <code className="bg-muted px-2 py-1 rounded text-sm font-mono">
          d3k --browser &apos;/Applications/Arc.app/Contents/MacOS/Arc&apos;
        </code>
      </>
    )
  },
  {
    question: "Does this only work with Next.js?",
    answer: (
      <>
        No. Works with any framework that runs a dev server—Next.js, Vite, Create React App, Rails, Django, etc. Use{" "}
        <code className="bg-muted px-2 py-1 rounded text-sm font-mono">--script</code> to specify your package.json dev
        command or <code className="bg-muted px-2 py-1 rounded text-sm font-mono">--port</code> to connect to an
        existing server.
      </>
    )
  },
  {
    question: "How do I stop dev3000?",
    answer: (
      <>
        <kbd className="bg-muted px-2 py-1 rounded text-sm font-mono">Ctrl+C</kbd> terminates the dev server and browser
        simultaneously.
      </>
    )
  },
  {
    question: "Does dev3000 affect my app's performance?",
    answer:
      "Minimal impact. dev3000 observes browser events passively through Chrome DevTools Protocol. The only overhead is capturing screenshots on errors and navigation, which happens asynchronously."
  },
  {
    question: "Where is my data stored?",
    answer: (
      <>
        All data stays local on your machine. Browser profiles are stored in{" "}
        <code className="bg-muted px-2 py-1 rounded text-sm font-mono">~/.dev3000/profiles</code>, and captured events
        are kept in memory during your session. Nothing is sent to external servers.
      </>
    )
  },
  {
    question: "Can I use dev3000 with my existing dev workflow?",
    answer: (
      <>
        Yes. Replace your normal dev command (
        <code className="bg-muted px-2 py-1 rounded text-sm font-mono">bun run dev</code>,{" "}
        <code className="bg-muted px-2 py-1 rounded text-sm font-mono">npm run dev</code>, etc.) with{" "}
        <code className="bg-muted px-2 py-1 rounded text-sm font-mono">d3k</code>. Everything else works exactly the
        same—hot reload, environment variables, custom ports, etc.
      </>
    )
  },
  {
    question: "What's the 'sharp' warning during installation?",
    answer:
      "Ignore it. Sharp is a Next.js image optimization dependency that dev3000 doesn't use. Some package managers run install scripts for all dependencies, but sharp is never invoked at runtime."
  }
] as const

const BleedContainer = ({ children, className }: { children: React.ReactNode; className?: string }) => {
  return <div className={clsx("md:-mx-40 px-6", className)}>{children}</div>
}
