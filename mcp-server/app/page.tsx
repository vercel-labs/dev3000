"use client"

import { useEffect, useState } from "react"
import { DarkModeToggle } from "@/components/dark-mode-toggle"
import { ChromeIcon, NextJsIcon } from "@/components/mcp-icons"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useDarkMode } from "@/hooks/use-dark-mode"

interface MCPTool {
  name: string
  description: string
  category: string
  parameters: Array<{
    name: string
    type: string
    optional?: boolean
    description: string
  }>
}

interface ToolsResponse {
  tools: MCPTool[]
  endpoint: string
  totalTools: number
  categories: string[]
}

interface OrchestratorResponse {
  orchestratorEnabled: boolean
  connectedMCPs: string[]
  totalConnections: number
  mcpDetails: Array<{
    name: string
    connected: boolean
    toolCount: number
    tools: string[]
    projects: string[]
  }>
  totalProjects: number
  projects: string[]
  message: string
}

// Format tool descriptions by parsing markdown-style sections
function formatToolDescription(description: string) {
  const slugify = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")

  // Split by double newline to get sections
  const sections = description.split("\n\n").filter((section) => section.trim())
  const keyCounts = new Map<string, number>()

  const getUniqueKey = (base: string) => {
    const count = keyCounts.get(base) ?? 0
    keyCounts.set(base, count + 1)
    return count === 0 ? base : `${base}-${count}`
  }

  return sections.map((rawSection, _idx) => {
    const normalizedKey = getUniqueKey(slugify(rawSection) || "section")
    let section = rawSection

    // Remove markdown formatting
    section = section.replace(/\*\*/g, "").trim()

    // Remove excessive emojis
    section = section.replace(/(\u{1F300}-\u{1F9FF}|\u{2600}-\u{26FF}|\u{1F900}-\u{1F9FF})+/gu, (match) => {
      return match.charAt(0)
    })

    // Handle different section types
    if (section.includes(":")) {
      // This is a header with content
      const [header, ...contentParts] = section.split(":")
      const cleanHeader = header.trim()
      const content = contentParts.join(":").trim()

      // Check if content has bullet points
      if (content.includes("•")) {
        const items = content.split("•").filter((item) => item.trim())
        const sectionKey = `${normalizedKey}-bullets`
        return (
          <div key={sectionKey}>
            <h5 className="font-semibold mb-2">{cleanHeader}</h5>
            <ul className="space-y-1 ml-4">
              {items.map((item) => {
                const itemKey = getUniqueKey(`${sectionKey}-item-${slugify(item).slice(0, 40) || "bullet"}`)
                return (
                  <li key={itemKey} className="flex items-start">
                    <span className="text-muted-foreground mr-2">•</span>
                    <span className="text-muted-foreground text-sm">{item.trim()}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      }

      return (
        <div key={`${normalizedKey}-content`}>
          <h5 className="font-semibold mb-1">{cleanHeader}</h5>
          <p className="text-muted-foreground text-sm ml-4">{content}</p>
        </div>
      )
    }

    // Handle numbered lists (like workflow steps)
    if (section.match(/^\d+[\ud83c-\ud83e][\udc00-\udfff]|^\d+\./m)) {
      const items = section.split(/\n/).filter((item) => item.trim())
      return (
        <ol className="space-y-1 ml-4" key={`${normalizedKey}-steps`}>
          {items.map((item, itemIdx) => {
            const cleanItem = item
              .replace(/^\d+[\ud83c-\ud83e][\udc00-\udfff]\s*/, "")
              .replace(/^\d+\.\s*/, "")
              .trim()
            return (
              <li
                key={getUniqueKey(`${normalizedKey}-step-${slugify(cleanItem).slice(0, 40) || "step"}`)}
                className="text-muted-foreground text-sm"
              >
                {itemIdx + 1}. {cleanItem}
              </li>
            )
          })}
        </ol>
      )
    }

    // Default paragraph
    return (
      <p key={`${normalizedKey}-paragraph`} className="text-muted-foreground text-sm leading-relaxed">
        {section}
      </p>
    )
  })
}

export default function HomePage() {
  const [tools, setTools] = useState<ToolsResponse | null>(null)
  const [orchestrator, setOrchestrator] = useState<OrchestratorResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [darkMode, setDarkMode] = useDarkMode()

  useEffect(() => {
    // Fetch both tools and orchestrator status in parallel
    Promise.all([fetch("/api/tools"), fetch("/api/orchestrator")])
      .then(([toolsRes, orchRes]) => Promise.all([toolsRes.json(), orchRes.json()]))
      .then(([toolsData, orchData]) => {
        setTools(toolsData)
        setOrchestrator(orchData)
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
      })
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="bg-muted/30 border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-4 mb-3">
                <div className="w-12 h-12 bg-foreground rounded flex items-center justify-center">
                  <span className="text-background font-mono font-bold">d3k</span>
                </div>
                <div>
                  <h1 className="text-3xl font-bold">dev3000 MCP Server</h1>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="inline-flex items-center gap-2 text-sm text-green-600 font-medium">
                      <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                      Server Running
                    </span>
                    <span className="text-muted-foreground">•</span>
                    <span className="text-sm text-muted-foreground">Port {process.env.PORT || "3684"}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Button variant="outline" asChild>
                <a href="https://github.com/vercel-labs/dev3000#setup" target="_blank" rel="noopener noreferrer">
                  📖 Setup Guide
                </a>
              </Button>
              <DarkModeToggle darkMode={darkMode} setDarkMode={setDarkMode} />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content - no sidebar needed with only 2 tools */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* MCP Connections Status */}
        <section className="mb-16">
          <Card className="bg-accent/10 border-accent/20">
            <CardHeader>
              <CardTitle>🔌 MCP Connections</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-[120px] space-y-4">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-12 w-1/2" />
                </div>
              ) : orchestrator ? (
                <>
                  <p className="text-sm text-muted-foreground mb-4">{orchestrator.message}</p>

                  {orchestrator.totalConnections > 0 ? (
                    <>
                      <div className="flex flex-wrap gap-3 mb-4">
                        {orchestrator.mcpDetails.map((mcp) => {
                          const Icon =
                            mcp.name === "chrome-devtools" ? ChromeIcon : mcp.name === "nextjs-dev" ? NextJsIcon : null
                          return (
                            <div
                              key={mcp.name}
                              className="inline-flex items-center gap-2 bg-background/50 border border-border rounded px-3 py-2"
                            >
                              {Icon && <Icon className="shrink-0" />}
                              <span className="font-semibold font-mono text-sm">{mcp.name}</span>
                              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                            </div>
                          )
                        })}
                      </div>
                      {orchestrator.totalProjects > 0 && (
                        <div className="text-sm text-muted-foreground">
                          <span className="font-medium">Active projects:</span>{" "}
                          {orchestrator.projects.map((project, idx) => (
                            <span key={project}>
                              <code className="text-foreground bg-background/50 px-1.5 py-0.5 rounded">{project}</code>
                              {idx < orchestrator.projects.length - 1 && ", "}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground bg-background/50 border border-border rounded p-4">
                      <p className="mb-2">⏳ Waiting for downstream MCPs to become available...</p>
                      <p className="text-xs">
                        dev3000 will automatically connect to <code className="text-foreground">chrome-devtools</code>{" "}
                        and <code className="text-foreground">nextjs-dev</code> MCPs when Chrome and your dev server
                        start.
                      </p>
                    </div>
                  )}
                </>
              ) : null}
            </CardContent>
          </Card>
        </section>

        {/* Tools Documentation */}
        <Card className="bg-accent/10 border-accent/20">
          <CardHeader>
            <CardTitle>🛠️ dev3000 Tools</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Skeleton loading states */}
                {[1, 2].map((i) => (
                  <div key={i} className="bg-background/50 border border-border rounded-lg p-6 h-[600px]">
                    <Skeleton className="h-6 w-3/4 mb-4" />
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-5/6" />
                      <Skeleton className="h-4 w-4/6" />
                    </div>
                  </div>
                ))}
              </div>
            ) : tools ? (
              <div className="grid gap-6 lg:grid-cols-2">
                {tools.tools.map((tool) => (
                  <div
                    key={tool.name}
                    id={tool.name}
                    className="bg-background/50 border border-border rounded-lg p-6 hover:border-muted-foreground/50 transition-colors"
                  >
                    <div className="mb-4">
                      <h4 className="text-xl font-semibold font-mono mb-3">{tool.name}</h4>
                      <div className="text-muted-foreground space-y-3">{formatToolDescription(tool.description)}</div>
                    </div>
                    {tool.parameters.length > 0 && (
                      <div>
                        <h5 className="text-sm font-semibold mb-3">Parameters:</h5>
                        <div className="space-y-2">
                          {tool.parameters.map((param) => (
                            <div key={param.name} className="text-sm">
                              <div className="flex items-start gap-2">
                                <span className="font-mono text-primary font-medium">{param.name}</span>
                                <span className="text-muted-foreground text-xs">
                                  {param.optional ? "(optional)" : "(required)"}
                                </span>
                                <span className="text-muted-foreground/70 text-xs">- {param.type}</span>
                              </div>
                              {param.description && (
                                <div className="text-muted-foreground ml-1 mt-1 text-sm">{param.description}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-16">
                <p className="text-destructive mb-6">Failed to load tool documentation</p>
                <Button onClick={() => window.location.reload()}>Retry</Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Magic Workflow */}
        <Card className="mt-20 bg-gradient-to-r from-primary/10 to-secondary/10">
          <CardHeader>
            <CardTitle className="text-2xl">🪄 The Magic Workflow</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4 shadow-md">
                  <span className="text-primary font-bold text-2xl">1</span>
                </div>
                <h3 className="font-semibold mb-3 text-lg">AI Finds Issues</h3>
                <p className="text-muted-foreground leading-relaxed">
                  fix_my_app automatically detects all types of errors and problems in your app
                </p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 bg-accent/20 rounded-full flex items-center justify-center mx-auto mb-4 shadow-md">
                  <span className="text-accent-foreground font-bold text-2xl">2</span>
                </div>
                <h3 className="font-semibold mb-3 text-lg">AI Fixes Code</h3>
                <p className="text-muted-foreground leading-relaxed">
                  AI analyzes errors and edits your code files to resolve issues
                </p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4 shadow-md">
                  <span className="text-green-600 dark:text-green-400 font-bold text-2xl">3</span>
                </div>
                <h3 className="font-semibold mb-3 text-lg">AI Verifies Fixes</h3>
                <p className="text-muted-foreground leading-relaxed">
                  execute_browser_action tests the fixes in real-time with screenshots
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-20">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div>
              <span className="font-semibold">dev3000 MCP Server</span> - AI-powered development monitoring
            </div>
            <div className="flex items-center gap-8">
              <a
                href="https://github.com/vercel-labs/dev3000"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors"
              >
                GitHub
              </a>
              <a
                href="https://dev3000.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors"
              >
                Homepage
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
