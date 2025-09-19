import { Camera, Clock, ExternalLink, Eye, Github, HelpCircle, Network, Play, Terminal, Zap } from "lucide-react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

const cursorConfig = {
  mcpServers: {
    dev3000: {
      type: "http",
      url: "http://localhost:3684/api/mcp/mcp"
    }
  }
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Grid Pattern Background */}
      <div className="absolute inset-0 grid-pattern opacity-50" />

      {/* Header */}
      <header className="relative border-b border-border/40">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-foreground rounded flex items-center justify-center">
                <span className="text-background font-mono font-bold text-sm">d3k</span>
              </div>
              <span className="font-semibold text-xl">dev3000</span>
              <Badge variant="secondary" className="ml-2">
                Vercel Labs
              </Badge>
            </div>
            <nav className="flex items-center gap-4">
              <div className="md:flex items-center gap-6">
                <Link href="/changelog" className="text-muted-foreground hover:text-foreground transition-colors">
                  Changelog
                </Link>
                <a
                  href="#quickstart"
                  className="hidden md:visible text-muted-foreground hover:text-foreground transition-colors"
                >
                  Quick Start
                </a>
              </div>
              <Button variant="outline" size="sm" className="border-gray-600/50" asChild>
                <a href="https://github.com/vercel-labs/dev3000" target="_blank" rel="noopener noreferrer">
                  <Github className="w-4 h-4 md:mr-2" />
                  <span className="hidden md:inline">GitHub</span>
                </a>
              </Button>
            </nav>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative py-8 md:py-10 border-b border-gray-700/30">
        <div className="container mx-auto px-4 text-center">
          <div className="max-w-4xl mx-auto">
            <Badge variant="secondary" className="mb-3">
              <Zap className="w-3 h-3 mr-1" />
              AI-Powered Debugging
            </Badge>
            <h1 className="text-3xl md:text-5xl font-bold mb-3 text-balance animate-fade-in-up">
              <span className="block">The browser for</span>
              <span className="block">AI-based development</span>
            </h1>
            <p className="text-base text-muted-foreground mb-4 text-pretty max-w-2xl mx-auto leading-relaxed">
              Captures server + browser logs, events, and network requests. Takes automatic screenshots and stiches it
              all into a unified, timestamped feed for AI and you.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center items-center">
              <Button size="lg" className="bg-foreground text-background hover:bg-foreground/90" asChild>
                <a href="#quickstart">
                  <Terminal className="w-4 h-4 mr-2" />
                  Get Started
                </a>
              </Button>
              <Button variant="outline" size="lg" className="border-2 !border-gray-700/30 p-5" asChild>
                <a href="https://github.com/vercel-labs/dev3000" target="_blank" rel="noopener noreferrer">
                  <Github className="w-4 h-4 mr-2" />
                  View on GitHub
                  <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Start */}
      {/* biome-ignore lint/correctness/useUniqueElementIds: page section IDs are intentionally static for navigation */}
      <section id="quickstart" className="relative py-6 border-b border-gray-700/30">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto text-center mb-5">
            <h2 className="text-2xl font-bold mb-2">Quick Start</h2>
            <p className="text-muted-foreground">Get up and running in seconds</p>
          </div>

          <div className="max-w-5xl mx-auto space-y-4">
            {/* Step 1: Install */}
            <Card className="bg-card/50 backdrop-blur-sm border-2 border-gray-700/40 card-hover shadow-lg hover:shadow-xl transition-all">
              <div className="p-4">
                <h3 className="font-semibold mb-3 text-lg flex items-center gap-2">
                  <span className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm font-bold">
                    1
                  </span>
                  Install dev3000
                </h3>
                <div className="bg-secondary/50 rounded p-3 font-mono text-sm border-2 border-gray-700/35 shadow-sm">
                  <div className="text-foreground">pnpm i -g dev3000</div>
                </div>
              </div>
            </Card>

            {/* Step 2: Replace your dev command */}
            <Card className="bg-card/50 backdrop-blur-sm border-2 border-gray-700/40 card-hover shadow-lg hover:shadow-xl transition-all">
              <div className="p-4">
                <h3 className="font-semibold mb-3 text-lg flex items-center gap-2">
                  <span className="w-6 h-6 bg-purple-500 text-white rounded-full flex items-center justify-center text-sm font-bold">
                    2
                  </span>
                  Replace your dev command
                </h3>
                <div className="space-y-3">
                  {/* Visual example 1 */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    <div className="bg-red-50 dark:bg-red-900/20 rounded p-2 font-mono text-sm flex-1 border border-red-200 dark:border-red-800">
                      <span className="text-muted-foreground">Instead of:</span>{" "}
                      <span className="text-foreground">pnpm dev</span>
                    </div>
                    <div className="text-2xl self-center">→</div>
                    <div className="bg-green-50 dark:bg-green-900/20 rounded p-2 font-mono text-sm flex-1 border border-green-200 dark:border-green-800">
                      <span className="text-muted-foreground">Run:</span>{" "}
                      <span className="text-foreground">dev3000</span>
                    </div>
                  </div>

                  {/* Visual example 2 */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    <div className="bg-red-50 dark:bg-red-900/20 rounded p-2 font-mono text-sm flex-1 border border-red-200 dark:border-red-800">
                      <span className="text-muted-foreground">Instead of:</span>{" "}
                      <span className="text-foreground">next dev -p 5000</span>
                    </div>
                    <div className="text-2xl self-center">→</div>
                    <div className="bg-green-50 dark:bg-green-900/20 rounded p-2 font-mono text-sm flex-1 border border-green-200 dark:border-green-800">
                      <span className="text-muted-foreground">Run:</span>{" "}
                      <span className="text-foreground">dev3000 --port 5000</span>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    <div className="bg-red-50 dark:bg-red-900/20 rounded p-2 font-mono text-sm flex-1 border border-red-200 dark:border-red-800">
                      <span className="text-muted-foreground">Instead of:</span>{" "}
                      <span className="text-foreground">pnpm build-start</span>
                    </div>
                    <div className="text-2xl self-center">→</div>
                    <div className="bg-green-50 dark:bg-green-900/20 rounded p-2 font-mono text-sm flex-1 border border-green-200 dark:border-green-800">
                      <span className="text-muted-foreground">Run:</span>{" "}
                      <span className="text-foreground">dev3000 --script build-start</span>
                    </div>
                  </div>

                  {/* Quick shortcut */}
                  <div className="bg-blue-50 dark:bg-blue-900/20 rounded p-3 border border-blue-200 dark:border-blue-800">
                    <div className="text-sm text-muted-foreground mb-1">Pro tip: Use the shortcut</div>
                    <div className="font-mono text-sm text-foreground">d3k</div>
                  </div>
                  <p>
                    More details in the{" "}
                    <Link href="https://github.com/vercel-labs/dev3000" className="text-sm text-muted-foreground">
                      README
                    </Link>
                  </p>
                </div>
              </div>
            </Card>

            {/* Step 3: Connect to Claude */}
            <Card className="bg-card/50 backdrop-blur-sm border-2 border-gray-700/40 card-hover shadow-lg hover:shadow-xl transition-all">
              <div className="p-4">
                <h3 className="font-semibold mb-3 text-lg flex items-center gap-2">
                  <span className="w-6 h-6 bg-green-500 text-white rounded-full flex items-center justify-center text-sm font-bold">
                    3
                  </span>
                  Connect to Claude/Cursor/Codex
                </h3>
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground mb-2">Add the MCP server to claude:</div>
                  <div className="bg-secondary/50 rounded p-3 font-mono text-xs border-2 border-gray-700/35 shadow-sm overflow-x-auto">
                    <div className="text-foreground whitespace-nowrap">
                      claude mcp add --transport http dev3000 http://localhost:3684/api/mcp/mcp
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Now Claude can read your logs, search for errors, and help debug in real-time!
                  </div>
                  <div className="text-xs text-yellow-400 mt-2">For Cursor:</div>
                  <code>
                    <pre>{JSON.stringify(cursorConfig, null, 2)}</pre>
                  </code>

                  <div className="text-xs text-blue-400 mt-2">For OpenAI Codex:</div>
                  <div className="bg-secondary/50 rounded p-3 font-mono text-xs border-2 border-gray-700/35 shadow-sm overflow-x-auto">
                    <div className="text-muted-foreground mb-1">Add to ~/.codex/config.toml:</div>
                    <div className="text-foreground whitespace-pre-wrap">
                      {`[mcp_servers]

  [mcp_servers.dev3000]
  url = "http://localhost:3684/api/mcp/mcp"`}
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            {/* What Happens Next */}
            <Card className="bg-card/50 backdrop-blur-sm border-2 border-gray-700/40 card-hover shadow-lg hover:shadow-xl transition-all">
              <div className="p-3">
                <h3 className="font-semibold mb-4">What happens next?</h3>
                <div className="grid md:grid-cols-3 gap-6 text-sm">
                  <div className="flex items-start gap-2">
                    <div className="w-6 h-6 bg-blue-400/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-blue-400 text-xs font-bold">1</span>
                    </div>
                    <div>
                      <div className="font-medium mb-1">Server Starts</div>
                      <div className="text-muted-foreground text-xs">
                        Your dev server launches and dev3000 begins monitoring
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-6 h-6 bg-emerald-400/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-emerald-400 text-xs font-bold">2</span>
                    </div>
                    <div>
                      <div className="font-medium mb-1">Browser Opens</div>
                      <div className="text-muted-foreground text-xs">
                        Automated CDP-connected browser starts capturing events and screenshots
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-6 h-6 bg-purple-400/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-purple-400 text-xs font-bold">3</span>
                    </div>
                    <div>
                      <div className="font-medium mb-1">Logs Available</div>
                      <div className="text-muted-foreground text-xs">
                        Visit localhost:3684/logs to see your unified timeline
                      </div>
                    </div>
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
              <span className="text-sm text-muted-foreground font-mono">/var/log/dev3000/dev3000-myapp-2025-09-19T12-54-03.log</span>
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
                  <div className="text-foreground">Read /tmp/dev3000.log</div>
                  <div className="text-muted-foreground mt-4 mb-2"># Or use MCP tools at</div>
                  <div className="text-foreground text-xs">http://localhost:3684/api/mcp/mcp</div>
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
                  <strong>Q: Getting a pnpm "approve-builds" warning?</strong>
                </div>
                <div className="text-muted-foreground mb-2">
                  <strong>A:</strong> If you're using pnpm 10+, run{" "}
                  <code className="bg-secondary/50 px-1 rounded font-mono text-xs">pnpm approve-builds -g</code> and
                  approve dev3000.
                </div>
              </li>

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
                  <Github className="w-4 h-4 mr-2" />
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
