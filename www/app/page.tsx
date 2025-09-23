import { ArrowRight, Github, Terminal } from "lucide-react"
import Link from "next/link"
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
  return (
    <div className="min-h-screen bg-background">
      {/* Grid Pattern Background */}
      <div className="absolute inset-0 grid-pattern" />

      {/* Header */}
      <header className="relative border-b">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-foreground rounded-md flex items-center justify-center">
                <span className="text-background font-mono font-bold text-sm">d3k</span>
              </div>
              <span className="font-semibold text-lg">dev3000</span>
            </div>
            <nav className="flex items-center gap-8">
              <Link href="/changelog" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Changelog
              </Link>
              <a href="#quickstart" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Quick Start
              </a>
              <Button variant="ghost" size="sm" asChild>
                <a href="https://github.com/vercel-labs/dev3000" target="_blank" rel="noopener noreferrer">
                  <Github className="w-4 h-4 mr-2" />
                  GitHub
                </a>
              </Button>
            </nav>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative py-20 md:py-28">
        <div className="container mx-auto px-6 text-center">
          <div className="max-w-3xl mx-auto">
            <Badge variant="secondary" className="mb-6 font-medium">
              By Vercel Labs
            </Badge>
            <h1 className="text-5xl md:text-7xl font-bold mb-6 tracking-tight">The browser for AI-based development</h1>
            <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
              Captures server + browser logs, events, and network requests. Takes automatic screenshots and stitches it
              all into a unified, timestamped feed for AI and you.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-16">
              <Button size="lg" className="text-base px-8 py-6" asChild>
                <a href="#quickstart">
                  Get Started
                  <ArrowRight className="w-4 h-4 ml-2" />
                </a>
              </Button>
              <Button variant="outline" size="lg" className="text-base px-8 py-6" asChild>
                <a href="https://github.com/vercel-labs/dev3000" target="_blank" rel="noopener noreferrer">
                  <Github className="w-4 h-4 mr-2" />
                  View on GitHub
                </a>
              </Button>
            </div>

            {/* Placeholder for screenshot */}
            <div className="relative mx-auto max-w-6xl">
              <div className="bg-gradient-to-b from-muted/50 to-muted/20 rounded-lg border p-8 min-h-[600px] flex items-center justify-center">
                <p className="text-muted-foreground text-lg">CLI + Browser Screenshot Goes Here</p>
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

                    <div className="text-sm text-muted-foreground">
                      <p className="mb-2">Works with any dev command:</p>
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
                  <h3 className="font-semibold mb-3 text-lg">Connect to your AI tool</h3>
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
                            For Cursor - Add to ~/.codex/config.toml:
                          </p>
                          <div className="bg-muted rounded-md p-3 font-mono text-xs">
                            <pre>{JSON.stringify(cursorConfig, null, 2)}</pre>
                          </div>
                        </div>
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Features */}
      {/* biome-ignore lint/correctness/useUniqueElementIds: page section IDs are intentionally static for navigation */}
      <section id="features" className="relative py-6 border-b border-gray-700/30">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto text-center mb-6">
            <h2 className="text-2xl font-bold mb-2">Everything AI Needs to Debug</h2>
            <p className="text-muted-foreground text-pretty text-sm">
              Comprehensive monitoring that captures your entire development context in one unified timeline
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3 max-w-6xl mx-auto">
            <Card className="bg-card/50 backdrop-blur-sm border-2 border-gray-700/40 p-3 card-hover shadow-lg hover:shadow-xl transition-all">
              <Terminal className="w-5 h-5 text-blue-400 mb-2 animate-pulse-soft" />
              <h3 className="font-semibold mb-1 text-sm">Server Logs</h3>
              <p className="text-sm text-muted-foreground">
                Complete server output and console messages with timestamps
              </p>
            </Card>

            <Card className="bg-card/50 backdrop-blur-sm border-2 border-gray-700/40 p-3 card-hover shadow-lg hover:shadow-xl transition-all">
              <Eye className="w-5 h-5 text-emerald-400 mb-2 animate-pulse-soft" />
              <h3 className="font-semibold mb-1 text-sm">Browser Events</h3>
              <p className="text-sm text-muted-foreground">Console messages, errors, clicks, scrolls, and key events</p>
            </Card>

            <Card className="bg-card/50 backdrop-blur-sm border-2 border-gray-700/40 p-3 card-hover shadow-lg hover:shadow-xl transition-all">
              <Network className="w-5 h-5 text-purple-400 mb-2 animate-pulse-soft" />
              <h3 className="font-semibold mb-1 text-sm">Network Requests</h3>
              <p className="text-sm text-muted-foreground">All HTTP requests and responses with full details</p>
            </Card>

            <Card className="bg-card/50 backdrop-blur-sm border-2 border-gray-700/40 p-3 card-hover shadow-lg hover:shadow-xl transition-all">
              <Camera className="w-5 h-5 text-orange-400 mb-2 animate-pulse-soft" />
              <h3 className="font-semibold mb-1 text-sm">Auto Screenshots</h3>
              <p className="text-sm text-muted-foreground">Automatic captures on navigation, errors, and key events</p>
            </Card>
          </div>
        </div>
      </section>

      {/* Interactive Demo */}
      <section className="relative py-6 bg-gradient-to-b from-transparent to-secondary/20 border-b border-gray-700/30">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto text-center mb-5">
            <h2 className="text-2xl font-bold mb-2">See It In Action</h2>
            <p className="text-muted-foreground text-sm">Watch how dev3000 captures everything in a unified timeline</p>
          </div>

          {/* CLI GIF */}
          <div className="max-w-4xl mx-auto mb-8">
            <Card className="bg-card/50 backdrop-blur-sm border-2 border-gray-700/40 overflow-hidden shadow-xl">
              {/* biome-ignore lint/performance/noImgElement: GIF animation not supported by next/image */}
              <img src="/cli.gif" alt="dev3000 CLI in action" className="w-full h-auto" />
            </Card>
          </div>

          <Card className="max-w-5xl mx-auto bg-card/50 backdrop-blur-sm border-2 border-gray-700/40 overflow-hidden shadow-xl">
            <div className="bg-secondary/30 px-3 py-1 border-b-2 border-gray-700/35 flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground font-mono">
                /var/log/dev3000/dev3000-myapp-2025-09-19T12-54-03.log
              </span>
              <div className="ml-auto flex items-center gap-2">
                <div className="w-2 h-2 bg-red-400 rounded-full" />
                <div className="w-2 h-2 bg-yellow-400 rounded-full" />
                <div className="w-2 h-2 bg-green-400 rounded-full" />
              </div>
            </div>
            <div className="p-3 font-mono text-sm space-y-1 max-h-52 overflow-y-auto">
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground text-xs whitespace-nowrap">12:54:03.033</span>
                <span className="text-blue-400 text-xs">[SERVER]</span>
                <span className="text-foreground">✓ Ready on http://localhost:3000</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground text-xs whitespace-nowrap">12:54:03.435</span>
                <span className="text-emerald-400 text-xs">[BROWSER]</span>
                <span className="text-foreground">[CONSOLE LOG] App initialized successfully</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground text-xs whitespace-nowrap">12:54:04.120</span>
                <span className="text-purple-400 text-xs">[NETWORK]</span>
                <span className="text-foreground">GET /api/users → 200 (142ms)</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground text-xs whitespace-nowrap">12:54:05.234</span>
                <span className="text-orange-400 text-xs">[SCREENSHOT]</span>
                <span className="text-foreground">📷 Captured: /login → /dashboard navigation</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground text-xs whitespace-nowrap">12:54:06.891</span>
                <span className="text-emerald-400 text-xs">[BROWSER]</span>
                <span className="text-foreground">[USER ACTION] Click: #submit-button</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground text-xs whitespace-nowrap">12:54:07.012</span>
                <span className="text-red-400 text-xs">[ERROR]</span>
                <span className="text-red-300">TypeError: Cannot read property 'id' of undefined</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground text-xs whitespace-nowrap">12:54:07.013</span>
                <span className="text-orange-400 text-xs">[SCREENSHOT]</span>
                <span className="text-foreground">📷 Auto-captured: Error state</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground text-xs whitespace-nowrap">12:54:07.256</span>
                <span className="text-purple-400 text-xs">[NETWORK]</span>
                <span className="text-foreground">POST /api/submit → 500 (23ms)</span>
              </div>
            </div>
            <div className="bg-secondary/20 px-4 py-3 border-t border-border/50">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <Play className="w-3 h-3" />
                <span>Real-time monitoring active</span>
                <span className="text-emerald-400">●</span>
                <span>8 events captured in the last 4 seconds</span>
              </div>
            </div>
          </Card>

          <div className="mt-8 text-center">
            <p className="text-sm text-muted-foreground mb-4">
              Everything is timestamped and unified - server logs, browser events, network requests, and screenshots
            </p>
            {/*
            <Button variant="outline" className="border-gray-600/50" asChild>
              <a
                href="https://github.com/vercel-labs/dev3000#examples"
                target="_blank"
                rel="noopener noreferrer"
              >
                View More Examples
                <ExternalLink className="w-3 h-3 ml-2" />
              </a>
            </Button>
            */}
          </div>
        </div>
      </section>

      {/* AI Integration */}
      <section className="relative py-6 border-b border-gray-700/30">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <Card className="bg-card/50 backdrop-blur-sm border-2 border-gray-700/40 p-4 shadow-xl">
              <div className="grid md:grid-cols-2 gap-4 items-center">
                <div>
                  <h3 className="text-xl font-bold mb-2">Built for AI Assistants</h3>
                  <p className="text-muted-foreground mb-3 leading-relaxed text-sm">
                    When you have a bug, Claude can see your server output, browser console, network requests, and
                    screenshots all in chronological order. No more context switching or missing details.
                  </p>
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 bg-emerald-400 rounded-full" />
                      <span className="text-sm">Unified timestamped feed</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 bg-blue-400 rounded-full" />
                      <span className="text-sm">MCP server integration</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 bg-purple-400 rounded-full" />
                      <span className="text-sm">Visual timeline at localhost:3684/logs</span>
                    </div>
                  </div>
                </div>
                <div className="bg-secondary/30 rounded p-3 font-mono text-sm border-2 border-gray-700/35 shadow-md">
                  <div className="text-muted-foreground mb-2"># Give AI your logs</div>
                  <div className="text-foreground">Read /var/log/dev3000/dev3000*.log</div>
                  <div className="text-muted-foreground mt-4 mb-2"># Or use MCP tools at</div>
                  <div className="text-foreground text-xs">http://localhost:3684/mcp</div>
                  <div className="text-muted-foreground mt-4 mb-1"># Visual timeline at</div>
                  <div className="text-foreground text-xs">http://localhost:3684/logs</div>
                </div>
              </div>
            </Card>
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
      <section className="relative py-6 bg-gradient-to-b from-transparent to-secondary/10">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto text-center mb-5">
            <h2 className="text-2xl font-bold mb-2">Vibes</h2>
          </div>

          <div className="max-w-4xl mx-auto">
            <Card className="bg-card/50 backdrop-blur-sm border-2 border-gray-700/40 overflow-hidden shadow-2xl">
              <div className="relative aspect-video">
                <video controls className="w-full h-full object-cover rounded" preload="metadata">
                  <source src="/d3k.mp4#t=0.25" type="video/mp4" />
                  Your browser does not support the video tag.
                </video>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="relative py-6 border-b border-gray-700/30">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto text-center mb-6">
            <h2 className="text-2xl font-bold mb-4 flex items-center justify-center gap-2">
              <HelpCircle className="w-6 h-6 text-blue-400" />
              FAQ
            </h2>
          </div>

          <div className="max-w-3xl mx-auto">
            <ul className="space-y-4 text-sm">
              <li>
                <div className="mb-1">
                  <strong>Q: Does dev3000 save my login state?</strong>
                </div>
                <div className="text-muted-foreground">
                  <strong>A:</strong> Yes, login state is saved automatically in the browser profile. No need to
                  re-login.
                </div>
              </li>

              <li>
                <div className="mb-1">
                  <strong>Q: How do I stop a dev3000 session?</strong>
                </div>
                <div className="text-muted-foreground">
                  <strong>A:</strong> Press <kbd className="bg-secondary/50 px-1 rounded text-xs">Ctrl+C</kbd> to stop
                  everything (server, browser, and MCP server).
                </div>
              </li>

              <li>
                <div className="mb-1">
                  <strong>Q: Does dev3000 work with other frameworks besides Next.js?</strong>
                </div>
                <div className="text-muted-foreground">
                  <strong>A:</strong> Yes, it works with React, Vue, Vite, etc. Use{" "}
                  <code className="bg-secondary/50 px-1 rounded font-mono text-xs">--script</code> to specify your dev
                  command.
                </div>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-border/40 py-6">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-foreground rounded flex items-center justify-center">
                <span className="text-background font-mono font-bold text-xs">d3k</span>
              </div>
              <span className="font-semibold">dev3000</span>
              <span className="text-muted-foreground text-xs">by Vercel Labs</span>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" className="border border-gray-600/50" asChild>
                <a href="https://github.com/vercel-labs/dev3000" target="_blank" rel="noopener noreferrer">
                  <Github className="w-4 h-4 mr-0" />
                  GitHub
                </a>
              </Button>
              <span className="text-xs text-muted-foreground">
                Made with ❤️ by{" "}
                <a href="https://github.com/elsigh" className="hover:text-foreground transition-colors">
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
