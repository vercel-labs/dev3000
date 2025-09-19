"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

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

export default function HomePage() {
  const [tools, setTools] = useState<ToolsResponse | null>(null)
  const [loading, setLoading] = useState(true)

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
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-gray-50 border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-4 mb-3">
                <div className="w-12 h-12 bg-black rounded flex items-center justify-center">
                  <span className="text-white font-mono font-bold">d3k</span>
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-gray-900">dev3000 MCP Server</h1>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="inline-flex items-center gap-2 text-sm text-green-600 font-medium">
                      <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                      Server Running
                    </span>
                    <span className="text-gray-300">•</span>
                    <span className="text-sm text-gray-600">Port {process.env.PORT || "3684"}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Link
                href="/logs"
                className="inline-flex items-center gap-2 px-5 py-3 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
              >
                📊 View Logs
              </Link>
              <a
                href="https://github.com/vercel-labs/dev3000#setup"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-3 border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 transition-colors"
              >
                📖 Setup Guide
              </a>
            </div>
          </div>
        </div>
      </header>

      <div className="flex max-w-7xl mx-auto">
        {/* Main Content */}
        <main className="flex-1 px-6 py-8 min-w-0 lg:pr-80">
          {/* Quick Start */}
          <section className="mb-16">
            <div className="bg-blue-50 border border-blue-200 rounded p-8">
              <h2 className="text-xl font-semibold text-blue-900 mb-4">🚀 Quick Start</h2>
              <div className="space-y-4">
                <div>
                  <span className="text-sm font-medium text-blue-800">MCP Endpoint:</span>
                  <code className="ml-3 px-4 py-2 bg-blue-100 text-blue-800 text-sm font-mono rounded">
                    {tools?.endpoint || "http://localhost:3684/api/mcp/mcp"}
                  </code>
                </div>
                <div className="text-sm text-blue-700">
                  <p className="mb-3">Connect your AI tools to this MCP server for real-time development debugging:</p>
                  <div className="flex gap-6">
                    <a
                      href="https://github.com/vercel-labs/dev3000#claude-desktop"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Claude Desktop Setup →
                    </a>
                    <a
                      href="https://github.com/vercel-labs/dev3000#cursor"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 font-medium"
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
                <h2 className="text-3xl font-bold text-gray-900 mb-3">Available Tools</h2>
                <p className="text-gray-600 text-lg">
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
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <p className="mt-6 text-gray-600">Loading tool documentation...</p>
              </div>
            ) : tools ? (
              <div className="grid gap-6 lg:grid-cols-2">
                {tools.tools.map((tool) => (
                  <div
                    key={tool.name}
                    id={tool.name}
                    className="border border-gray-200 rounded p-6 hover:border-gray-300 transition-colors"
                  >
                    <div className="mb-4">
                      <h4 className="text-xl font-semibold text-gray-900 font-mono mb-3">{tool.name}</h4>
                      <p className="text-gray-600 leading-relaxed">
                        {tool.description.replace(/🚨|⏰|🔍|🪄|📊|🌐|⚙️/g, "").trim()}
                      </p>
                    </div>
                    {tool.parameters.length > 0 && (
                      <div>
                        <h5 className="text-sm font-semibold text-gray-800 mb-3">Parameters:</h5>
                        <div className="space-y-2">
                          {tool.parameters.map((param) => (
                            <div key={param.name} className="text-sm">
                              <div className="flex items-start gap-2">
                                <span className="font-mono text-blue-600 font-medium">{param.name}</span>
                                <span className="text-gray-500 text-xs">
                                  {param.optional ? "(optional)" : "(required)"}
                                </span>
                                <span className="text-gray-400 text-xs">- {param.type}</span>
                              </div>
                              {param.description && (
                                <div className="text-gray-600 ml-1 mt-1 text-sm">{param.description}</div>
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
                <p className="text-red-600 mb-6">Failed to load tool documentation</p>
                <button
                  onClick={() => window.location.reload()}
                  className="px-6 py-3 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                  type="button"
                >
                  Retry
                </button>
              </div>
            )}
          </section>

          {/* Magic Workflow */}
          <section className="mt-20 bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded p-10">
            <h2 className="text-2xl font-semibold text-gray-900 mb-6 flex items-center gap-3">🪄 The Magic Workflow</h2>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-blue-600 font-bold text-lg">1</span>
                </div>
                <h3 className="font-semibold mb-3 text-lg">AI Finds Issues</h3>
                <p className="text-gray-600 leading-relaxed">
                  Tools like debug_my_app and monitor_for_new_errors automatically detect problems
                </p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-purple-600 font-bold text-lg">2</span>
                </div>
                <h3 className="font-semibold mb-3 text-lg">AI Fixes Code</h3>
                <p className="text-gray-600 leading-relaxed">
                  AI analyzes errors and edits your code files to resolve issues
                </p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-green-600 font-bold text-lg">3</span>
                </div>
                <h3 className="font-semibold mb-3 text-lg">AI Verifies Fixes</h3>
                <p className="text-gray-600 leading-relaxed">
                  execute_browser_action tests the fixes in real-time with screenshots
                </p>
              </div>
            </div>
          </section>
        </main>

        {/* Table of Contents - Sticky Sidebar (Right) */}
        <aside className="lg:block w-72 flex-shrink-0 fixed right-0 top-0 h-screen overflow-y-auto z-10">
          <div className="p-6 bg-gray-50 border-l border-gray-200 h-full">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Tools</h3>
            {loading ? (
              <div className="text-sm text-gray-500">Loading tools...</div>
            ) : tools ? (
              <nav className="space-y-1 text-sm">
                {tools.tools.map((tool) => (
                  <a
                    key={tool.name}
                    href={`#${tool.name}`}
                    className="text-gray-600 hover:text-blue-600 transition-colors block py-2 px-3 rounded hover:bg-white"
                  >
                    {tool.name}
                  </a>
                ))}
              </nav>
            ) : (
              <div className="text-sm text-gray-500">Failed to load tools</div>
            )}
          </div>
        </aside>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-20">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <div>
              <span className="font-semibold">dev3000 MCP Server</span> - AI-powered development monitoring
            </div>
            <div className="flex items-center gap-8">
              <a
                href="https://github.com/vercel-labs/dev3000"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-gray-900 transition-colors"
              >
                GitHub
              </a>
              <a
                href="https://dev3000.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-gray-900 transition-colors"
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
