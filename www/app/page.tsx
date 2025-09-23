"use client"

import { ArrowRight, Github } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import Balancer from "react-wrap-balancer"
import { DarkModeToggle } from "@/components/dark-mode-toggle"
import { GitHubLink } from "@/components/github-link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

const cursorConfig = {
  mcpServers: {
    dev3000: {
      type: "http",
      url: "http://localhost:3684/mcp"
    }
  }
}

export default function HomePage() {
  const [isScrolled, setIsScrolled] = useState(false)
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const handleScroll = () => {
      // Check if the hero buttons are out of viewport (roughly after hero section)
      setIsScrolled(window.scrollY > 400)
    }

    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b bg-background/80 backdrop-blur-md">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-foreground rounded-md flex items-center justify-center">
                <span className="text-background font-mono font-bold text-sm">d3k</span>
              </div>
              <span className="font-semibold text-lg">dev3000</span>
            </div>
            <nav className="flex items-center gap-4">
              {/* Show GitHub button when scrolled */}
              <div
                className={`transition-all duration-300 ${
                  isScrolled ? "opacity-100" : "opacity-0 pointer-events-none"
                }`}
              >
                <GitHubLink />
              </div>

              {/* Changelog stays on the far right */}
              <Link
                href="/changelog"
                className="text-sm text-muted-foreground hover:text-foreground hover:underline transition-colors"
              >
                Changelog
              </Link>

              {/* Dark mode toggle */}
              {mounted && (
                <DarkModeToggle darkMode={theme === "dark"} setDarkMode={(dark) => setTheme(dark ? "dark" : "light")} />
              )}
            </nav>
          </div>
        </div>
      </header>

      {/* Spacer for fixed header */}
      <div className="h-[73px]" />

      {/* Hero Section */}
      <section className="relative py-20 md:py-28">
        <div className="container mx-auto px-6 text-center">
          <div className="max-w-3xl mx-auto">
            <Badge
              variant="secondary"
              className="mb-6 font-medium dark:bg-secondary/50 dark:border dark:border-secondary"
            >
              By Vercel Labs
            </Badge>
            <h1 className="text-5xl md:text-7xl font-bold mb-6 tracking-tight">
              <Balancer>The browser for AI-based development</Balancer>
            </h1>
            <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
              <Balancer>
                Captures server + browser logs, events, and network requests. Takes automatic screenshots and stitches
                it all into a unified, timestamped feed for AI and you.
              </Balancer>
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-16">
              <Button size="lg" className="text-base px-8 py-6" asChild>
                <a href="#quickstart">
                  Get Started
                  <ArrowRight className="w-4 h-4 ml-2" />
                </a>
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="text-base px-8 py-6 dark:border-zinc-700 dark:bg-zinc-900/50 dark:hover:bg-zinc-800 dark:shadow-sm"
                asChild
              >
                <a href="https://github.com/vercel-labs/dev3000" target="_blank" rel="noopener noreferrer">
                  <Github className="w-4 h-4" />
                  View on GitHub
                </a>
              </Button>
            </div>

            {/* Hero Screenshot */}
            <div className="relative mx-auto max-w-6xl">
              <div className="rounded-xl border shadow-2xl overflow-hidden">
                <Image
                  src="/d3k-hero.jpg"
                  alt="dev3000 CLI and browser interface"
                  width={1200}
                  height={675}
                  className="w-full h-auto"
                  priority
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Start */}
      {/* biome-ignore lint/correctness/useUniqueElementIds: page section IDs are intentionally static for navigation */}
      <section id="quickstart" className="relative py-20 border-b">
        <div className="container mx-auto px-6">
          <div className="max-w-2xl mx-auto text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Quick Start</h2>
            <p className="text-lg text-muted-foreground">Get up and running in seconds</p>
          </div>

          <div className="max-w-3xl mx-auto space-y-6">
            {/* Step 1: Install */}
            <Card className="bg-card border p-6">
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-foreground text-background rounded-full flex items-center justify-center flex-shrink-0 font-semibold">
                  1
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold mb-3 text-lg">Install dev3000</h3>
                  <div className="bg-muted rounded-md p-4 font-mono text-sm">pnpm i -g dev3000</div>
                </div>
              </div>
            </Card>

            {/* Step 2: Replace your dev command */}
            <Card className="bg-card border p-6">
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-foreground text-background rounded-full flex items-center justify-center flex-shrink-0 font-semibold">
                  2
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold mb-3 text-lg">Replace your dev command</h3>
                  <div className="space-y-3">
                    <div className="bg-muted rounded-md p-4">
                      <div className="flex items-center gap-4 font-mono text-sm">
                        <span className="text-muted-foreground">Instead of:</span>
                        <code className="text-foreground">pnpm dev</code>
                        <span className="text-muted-foreground mx-2">→</span>
                        <span className="text-muted-foreground">Run:</span>
                        <code className="text-foreground font-semibold">dev3000</code>
                      </div>
                    </div>

                    <details className="group">
                      <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                        Works with any dev command
                      </summary>
                      <div className="mt-3 text-sm text-muted-foreground">
                        <ul className="space-y-1 font-mono text-xs">
                          <li>
                            • <code>next dev -p 5000</code> → <code className="font-semibold">dev3000 -p 5000</code>
                          </li>
                          <li>
                            • <code>pnpm build-start</code> →{" "}
                            <code className="font-semibold">dev3000 -s build-start</code>
                          </li>
                          <li>
                            • Or use the shortcut: <code className="font-semibold">d3k</code>
                          </li>
                        </ul>
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            </Card>

            {/* Step 3: Connect to Claude */}
            <Card className="bg-card border p-6">
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-foreground text-background rounded-full flex items-center justify-center flex-shrink-0 font-semibold">
                  3
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold mb-3 text-lg">Connect your AI tool</h3>
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">For Claude Code:</p>
                      <div className="bg-muted rounded-md p-3 font-mono text-xs overflow-x-auto">
                        claude mcp add -t http -s user dev3000 http://localhost:3684/mcp
                      </div>
                    </div>
                    <details className="group">
                      <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                        Other AI tools (Cursor, OpenAI Codex)
                      </summary>
                      <div className="mt-3 space-y-3">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">
                            For Cursor (Settings &gt; Cursor Settings &gt; MCP)
                          </p>
                          <div className="bg-muted rounded-md p-3 font-mono text-xs">
                            <pre>{JSON.stringify(cursorConfig, null, 2)}</pre>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">For OpenAI Codex (~/.codex/config.toml)</p>
                          <div className="bg-muted rounded-md p-3 font-mono text-xs">
                            <pre>{`[mcp_servers]

  [mcp_servers.dev3000]
  url = "http://localhost:3684/mcp"`}</pre>
                          </div>
                        </div>
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            </Card>

            {/* Step 4: Fix my app */}
            <Card className="bg-card border p-6">
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-foreground text-background rounded-full flex items-center justify-center flex-shrink-0 font-semibold">
                  4
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold mb-3 text-lg">AI fixes your bugs with complete context</h3>
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">Type this into Claude Code:</p>
                    <div className="bg-muted rounded-md p-4 font-mono text-sm">fix my app</div>
                    <p className="text-sm text-muted-foreground">
                      Watch as the MCP tools start an agentic loop to automatically find, fix, and verify bugs in your
                      application.
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="relative py-20 bg-muted/30">
        <div className="container mx-auto px-6">
          <div className="max-w-2xl mx-auto text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Everything your AI needs</h2>
            <p className="text-lg text-muted-foreground">Comprehensive monitoring in one unified timeline</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            <div className="text-center">
              <div className="w-12 h-12 bg-foreground text-background rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <h3 className="font-semibold mb-2">Server Logs</h3>
              <p className="text-sm text-muted-foreground">Complete server output with timestamps</p>
            </div>

            <div className="text-center">
              <div className="w-12 h-12 bg-foreground text-background rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              </div>
              <h3 className="font-semibold mb-2">Browser Events</h3>
              <p className="text-sm text-muted-foreground">Console, errors, clicks, and interactions</p>
            </div>

            <div className="text-center">
              <div className="w-12 h-12 bg-foreground text-background rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="font-semibold mb-2">Network Requests</h3>
              <p className="text-sm text-muted-foreground">HTTP requests with full details</p>
            </div>

            <div className="text-center">
              <div className="w-12 h-12 bg-foreground text-background rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </div>
              <h3 className="font-semibold mb-2">Auto Screenshots</h3>
              <p className="text-sm text-muted-foreground">Captures on errors and navigation</p>
            </div>
          </div>
        </div>
      </section>

      {/* CLI Demo */}
      <section className="relative py-20 border-b">
        <div className="container mx-auto px-6">
          <div className="max-w-2xl mx-auto text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">See it in action</h2>
            <p className="text-lg text-muted-foreground">Watch how dev3000 captures everything in a unified timeline</p>
          </div>

          {/* CLI GIF */}
          <div className="max-w-4xl mx-auto">
            <Card className="bg-card border overflow-hidden">
              <Image
                src="/cli.gif"
                alt="dev3000 CLI in action"
                width={1024}
                height={640}
                className="w-full h-auto"
                unoptimized // GIFs need unoptimized flag
              />
            </Card>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="relative py-20">
        <div className="container mx-auto px-6">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold mb-4">How it works</h2>
              <p className="text-lg text-muted-foreground">dev3000 gives your AI the complete picture</p>
            </div>

            <div className="space-y-8">
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center flex-shrink-0 font-semibold">
                  1
                </div>
                <div>
                  <h3 className="font-semibold mb-2">Automatic capture</h3>
                  <p className="text-muted-foreground">
                    dev3000 monitors your dev server, browser console, network requests, and takes automatic screenshots
                    - all synchronized with timestamps.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center flex-shrink-0 font-semibold">
                  2
                </div>
                <div>
                  <h3 className="font-semibold mb-2">Unified timeline</h3>
                  <p className="text-muted-foreground">
                    Everything is merged into a single chronological log file, making it easy to see what happened when.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center flex-shrink-0 font-semibold">
                  3
                </div>
                <div>
                  <h3 className="font-semibold mb-2">AI-ready context</h3>
                  <p className="text-muted-foreground">
                    Just type "fix my app" and your AI assistant gets the complete context through MCP tools or by
                    reading the log files directly.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials 
      <section className="relative py-16 bg-gradient-to-b from-secondary/10 to-transparent">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Loved by Developers</h2>
            <p className="text-muted-foreground">
              See what developers are saying about dev3000
            </p>
          </div>

          
          <div className="grid sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8 max-w-6xl mx-auto">
            <Card className="bg-card/50 backdrop-blur-sm border-2 border-gray-700/40 p-3 card-hover shadow-lg hover:shadow-xl transition-all">
              <Quote className="w-8 h-8 text-blue-400 mb-4 opacity-60" />
              <p className="text-sm leading-relaxed mb-4">
                "Finally! A tool that gives me the complete picture when
                debugging. The unified timeline saved me hours tracking down a
                race condition."
              </p>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-r from-blue-400 to-purple-400 rounded-full flex items-center justify-center">
                  <span className="text-xs font-bold text-white">SJ</span>
                </div>
                <div>
                  <div className="font-medium text-sm">Sarah Johnson</div>
                  <div className="text-xs text-muted-foreground">
                    Senior Frontend Engineer
                  </div>
                </div>
              </div>
            </Card>

            <Card className="bg-card/50 backdrop-blur-sm border-2 border-gray-700/40 p-3 card-hover shadow-lg hover:shadow-xl transition-all">
              <Quote className="w-8 h-8 text-emerald-400 mb-4 opacity-60" />
              <p className="text-sm leading-relaxed mb-4">
                "Game changer for debugging Next.js apps. The automatic
                screenshots when errors occur are incredibly helpful."
              </p>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-r from-emerald-400 to-teal-400 rounded-full flex items-center justify-center">
                  <span className="text-xs font-bold text-white">MR</span>
                </div>
                <div>
                  <div className="font-medium text-sm">Mike Rodriguez</div>
                  <div className="text-xs text-muted-foreground">
                    Full Stack Developer
                  </div>
                </div>
              </div>
            </Card>

            <Card className="bg-card/50 backdrop-blur-sm border-2 border-gray-700/40 p-3 card-hover shadow-lg hover:shadow-xl transition-all">
              <Quote className="w-8 h-8 text-purple-400 mb-4 opacity-60" />
              <p className="text-sm leading-relaxed mb-4">
                "The MCP integration with Claude is brilliant. I can just ask
                'what went wrong?' and get instant insights."
              </p>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full flex items-center justify-center">
                  <span className="text-xs font-bold text-white">AK</span>
                </div>
                <div>
                  <div className="font-medium text-sm">Alex Kim</div>
                  <div className="text-xs text-muted-foreground">Tech Lead</div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>
      */}

      {/* Video Demo */}
      <section className="relative py-20 bg-muted/30">
        <div className="container mx-auto px-6">
          <div className="max-w-2xl mx-auto text-center mb-12">
            <h2 className="text-3xl font-bold">Vibes</h2>
          </div>

          <div className="max-w-4xl mx-auto">
            <Card className="bg-card border overflow-hidden">
              <div className="relative aspect-video">
                <video controls className="w-full h-full object-cover" preload="metadata">
                  <source src="/d3k.mp4#t=0.25" type="video/mp4" />
                  Your browser does not support the video tag.
                </video>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="relative py-20 border-b">
        <div className="container mx-auto px-6">
          <div className="max-w-2xl mx-auto text-center mb-12">
            <h2 className="text-3xl font-bold">Frequently Asked Questions</h2>
          </div>

          <div className="max-w-3xl mx-auto space-y-6">
            <div className="border rounded-lg p-6">
              <h3 className="font-semibold mb-2">Does dev3000 save my login state?</h3>
              <p className="text-muted-foreground">
                Yes, login state is saved automatically in a unique browser profile for each project. No need to
                re-login.
              </p>
            </div>

            <div className="border rounded-lg p-6">
              <h3 className="font-semibold mb-2">How do I stop a dev3000 session?</h3>
              <p className="text-muted-foreground">
                Press <kbd className="bg-muted px-2 py-1 rounded text-sm font-mono">Ctrl+C</kbd> to stop everything
                (server, browser, and MCP server).
              </p>
            </div>

            <div className="border rounded-lg p-6">
              <h3 className="font-semibold mb-2">Does dev3000 work with other frameworks besides Next.js?</h3>
              <p className="text-muted-foreground">
                Yes, it works with React, Vue, Vite, etc. Use{" "}
                <code className="bg-muted px-2 py-1 rounded text-sm font-mono">--script</code> to specify your dev
                command.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative py-12">
        <div className="container mx-auto px-6">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-foreground rounded-md flex items-center justify-center">
                <span className="text-background font-mono font-bold text-sm">d3k</span>
              </div>
              <div>
                <p className="font-semibold">dev3000</p>
                <p className="text-sm text-muted-foreground">By Vercel Labs</p>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <a
                href="/changelog"
                className="text-sm text-muted-foreground hover:text-foreground hover:underline transition-colors"
              >
                Changelog
              </a>
              <GitHubLink />
              <span className="text-sm text-muted-foreground">
                Made by{" "}
                <a href="https://github.com/elsigh" className="hover:text-foreground hover:underline transition-colors">
                  elsigh
                </a>
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
