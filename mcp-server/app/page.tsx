"use client"

import { useEffect, useState } from "react"

interface HealthStatus {
  status: string
  timestamp: string
  mcpEndpoint: string
  logFile: {
    path: string
    exists: boolean
  }
  version: string
}

export default function HomePage() {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/health")
      .then(res => res.json())
      .then(data => {
        setHealth(data)
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
      })
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <a
        href="https://github.com/vercel-labs/dev3000"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed top-4 right-4 text-gray-600 hover:text-gray-900 transition-colors"
        title="View on GitHub"
      >
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 0C5.374 0 0 5.373 0 12 0 17.302 3.438 21.8 8.207 23.387c.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
        </svg>
      </a>
      
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-2xl w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">🎯 dev3000</h1>
          <p className="text-gray-600">AI-powered development monitoring</p>
        </div>

        {/* Health Status */}
        <div className="mb-8 p-4 bg-gray-50 rounded-lg">
          <h2 className="text-lg font-semibold mb-3 flex items-center">
            {loading ? "⏳" : health?.status === "healthy" ? "✅" : "❌"} 
            <span className="ml-2">Server Status</span>
          </h2>
          {loading ? (
            <p className="text-gray-600">Checking health...</p>
          ) : health ? (
            <div className="space-y-2 text-sm">
              <p><span className="font-medium">Status:</span> {health.status}</p>
              <p><span className="font-medium">Version:</span> {health.version}</p>
              <p><span className="font-medium">Log File:</span> {health.logFile.exists ? "✅" : "❌"} {health.logFile.path}</p>
            </div>
          ) : (
            <p className="text-red-600">Failed to get health status</p>
          )}
        </div>

        {/* Navigation */}
        <div className="space-y-4 mb-8">
          <a
            href="/logs"
            className="block w-full bg-blue-500 text-white text-center py-3 px-4 rounded hover:bg-blue-600 transition-colors"
          >
            📊 View Development Logs
          </a>
        </div>

        {/* MCP Configuration */}
        <div className="border-t pt-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            🤖 <span className="ml-2">MCP Integration</span>
          </h2>
          
          <div className="bg-blue-50 p-4 rounded-lg mb-4">
            <p className="text-sm text-blue-800 mb-2">
              <span className="font-medium">Endpoint:</span> 
              <code className="bg-blue-100 px-2 py-1 rounded text-xs ml-2">
                http://localhost:{typeof window !== "undefined" ? window.location.port : "3684"}/api/mcp/mcp
              </code>
            </p>
            <p className="text-xs text-blue-600">
              Use HTTP transport (not stdio) when configuring MCP clients
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="font-medium text-gray-900">Configure AI Tools:</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <a
                href="https://github.com/vercel-labs/dev3000#claude-desktop"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 border rounded hover:bg-gray-50 transition-colors text-sm"
              >
                <span>Claude Desktop</span>
                <span className="text-gray-400">↗</span>
              </a>
              <a
                href="https://github.com/vercel-labs/dev3000#mcp-clients"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 border rounded hover:bg-gray-50 transition-colors text-sm"
              >
                <span>Other MCP Clients</span>
                <span className="text-gray-400">↗</span>
              </a>
            </div>
          </div>
        </div>

        <div className="mt-8 text-sm text-gray-600 text-center border-t pt-6">
          <p>Real-time development monitoring with visual context</p>
          <p className="mt-1">Server logs + Browser events + Screenshots + AI debugging</p>
        </div>
      </div>
    </div>
  )
}
