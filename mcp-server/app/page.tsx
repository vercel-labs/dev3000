"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { DarkModeToggle } from "@/components/dark-mode-toggle"
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

    // Remove excessive emojis
    // Simple emoji reduction - just remove most emojis except the first in sequences
    section = section.replace(/(\u{1F300}-\u{1F9FF}|\u{2600}-\u{26FF}|\u{1F900}-\u{1F9FF})+/gu, (match) => {
      // Keep only the first emoji in a sequence
      return match.charAt(0)
    })

    // Handle different section types
    if (section.includes("**") && section.includes(":")) {
      // This is a header with content
      const [header, ...contentParts] = section.split(":")
      const cleanHeader = header.replace(/\*\*/g, "").trim()
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
            // Clean up the item text
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
  const [loading, setLoading] = useState(true)
  const [darkMode, setDarkMode] = useDarkMode()

  useEffect(() => {
    fetch("/api/tools")
      .then((res) => res.json())
      .then((data) => {
        setTools(data)
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
              <Link
                href="/logs"
                className="inline-flex items-center gap-2 px-5 py-3 bg-primary text-primary-foreground text-sm font-medium rounded hover:bg-primary/90 transition-colors"
              >
                📊 View Logs
              </Link>
              <a
                href="https://github.com/vercel-labs/dev3000#setup"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-3 border border-border text-foreground text-sm font-medium rounded hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                📖 Setup Guide
              </a>
              <DarkModeToggle darkMode={darkMode} setDarkMode={setDarkMode} />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content - no sidebar needed with only 2 tools */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Quick Start */}
        <section className="mb-16">
          <div className="bg-primary/10 border border-primary/20 rounded p-8">
            <h2 className="text-xl font-semibold mb-4">🚀 Quick Start</h2>
            <div className="space-y-4">
              <div>
                <span className="text-sm font-medium">MCP Endpoint:</span>
                <code className="ml-3 px-4 py-2 bg-primary/20 text-foreground text-sm font-mono rounded">
                  {tools?.endpoint || "http://localhost:3684/mcp"}
                </code>
              </div>
              <div className="text-sm">
                <p className="mb-3">Connect your AI tools to this MCP server for real-time development debugging:</p>
                <div className="flex gap-6">
                  <a
                    href="https://github.com/vercel-labs/dev3000#claude-desktop"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:text-primary/80 font-medium"
                  >
                    Claude Desktop Setup →
                  </a>
                  <a
                    href="https://github.com/vercel-labs/dev3000#cursor"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:text-primary/80 font-medium"
                  >
                    Cursor Setup →
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Tools Documentation */}
        <section>
          <div className="mb-12">
            <div>
              <h2 className="text-3xl font-bold mb-3">Available Tools</h2>
              <p className="text-muted-foreground text-lg">
                {loading
                  ? "Loading MCP tools..."
                  : `${tools?.totalTools || 0} tools across ${
                      tools?.categories.length || 0
                    } categories for AI-powered development debugging`}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-16">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p className="mt-6 text-muted-foreground">Loading tool documentation...</p>
            </div>
          ) : tools ? (
            <div className="grid gap-6 lg:grid-cols-2">
              {tools.tools.map((tool) => (
                <div
                  key={tool.name}
                  id={tool.name}
                  className="border border-border rounded-lg p-6 hover:border-muted-foreground/50 transition-colors"
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
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-3 bg-primary text-primary-foreground text-sm rounded hover:bg-primary/90 transition-colors"
                type="button"
              >
                Retry
              </button>
            </div>
          )}
        </section>

        {/* Magic Workflow */}
        <section className="mt-20 bg-gradient-to-r from-primary/10 to-secondary/10 border border-border rounded-lg p-10">
          <h2 className="text-2xl font-semibold mb-6 flex items-center gap-3">🪄 The Magic Workflow</h2>
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
        </section>
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
              <Link href="/logs" className="hover:text-gray-900 transition-colors">
                Logs
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
