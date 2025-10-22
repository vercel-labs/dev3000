/**
 * MCP Client Manager - Orchestrates connections to downstream MCP servers
 *
 * This implements the "orchestrator" or "gateway" pattern where dev3000 acts as:
 * - MCP Server (to AI clients like Claude)
 * - MCP Client (to chrome-devtools and nextjs-dev MCPs)
 *
 * Benefits:
 * - Users only configure dev3000 once globally
 * - Auto-discovery of chrome-devtools and nextjs-dev MCPs
 * - Reduced context bloat for AI clients
 * - Intelligent orchestration across multiple MCP sources
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js"

interface MCPClientConfig {
  name: string
  type: "http" | "stdio"
  url?: string // For HTTP transport
  command?: string // For stdio transport
  args?: string[] // For stdio transport
  enabled: boolean
}

export class MCPClientManager {
  private clients: Map<string, Client> = new Map()
  private transports: Map<string, StreamableHTTPClientTransport | StdioClientTransport> = new Map()
  private tools: Map<string, Tool[]> = new Map()
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map()
  private lastConfigs: Map<string, MCPClientConfig> = new Map()
  private toolDiscoveryListeners: Array<() => void> = []
  private toolUpdateSubscribers: Array<(info: { mcpName: string; tools: Tool[] }) => void> = []

  /**
   * Initialize MCP clients for available downstream servers
   */
  async initialize(config: {
    chromeDevtools?: { command: string; args: string[]; enabled: boolean }
    nextjsDev?: { command: string; args: string[]; enabled: boolean }
    svelteDev?: { command: string; args: string[]; enabled: boolean }
  }): Promise<void> {
    const configs: MCPClientConfig[] = []

    if (config.chromeDevtools?.enabled) {
      configs.push({
        name: "chrome-devtools",
        type: "stdio",
        command: config.chromeDevtools.command,
        args: config.chromeDevtools.args,
        enabled: true
      })
    }

    if (config.nextjsDev?.enabled) {
      configs.push({
        name: "nextjs-dev",
        type: "stdio",
        command: config.nextjsDev.command,
        args: config.nextjsDev.args,
        enabled: true
      })
    }

    if (config.svelteDev?.enabled) {
      configs.push({
        name: "svelte-dev",
        type: "stdio",
        command: config.svelteDev.command,
        args: config.svelteDev.args,
        enabled: true
      })
    }

    // Connect to each available MCP
    for (const cfg of configs) {
      try {
        await this.connectToMCP(cfg)
        const location = cfg.type === "http" ? cfg.url : `${cfg.command} ${cfg.args?.join(" ")}`
        console.log(`[MCP Orchestrator] Connected to ${cfg.name} (${cfg.type}) at ${location}`)
      } catch (error) {
        console.warn(`[MCP Orchestrator] Failed to connect to ${cfg.name}:`, error)
      }
    }
  }

  /**
   * Connect to a downstream MCP server
   */
  private async connectToMCP(config: MCPClientConfig): Promise<void> {
    // Store config for reconnection
    this.lastConfigs.set(config.name, config)

    const client = new Client(
      {
        name: "dev3000-orchestrator",
        version: "1.0.0"
      },
      {
        capabilities: {}
      }
    )

    client.onerror = (error) => {
      console.error(`[MCP Orchestrator] ${config.name} error:`, error)
      // Schedule reconnection for HTTP transports (SSE disconnects)
      if (config.type === "http") {
        this.scheduleReconnect(config.name)
      }
    }

    let transport: StreamableHTTPClientTransport | StdioClientTransport

    if (config.type === "http" && config.url) {
      transport = new StreamableHTTPClientTransport(new URL(config.url))
    } else if (config.type === "stdio" && config.command) {
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args || []
      })
    } else {
      throw new Error(`Invalid MCP config for ${config.name}`)
    }

    await client.connect(transport)

    this.clients.set(config.name, client)
    this.transports.set(config.name, transport)

    // Discover available tools (non-fatal - connection already succeeded)
    try {
      const toolsResult = await client.listTools()
      const discoveredTools = Array.isArray(toolsResult?.tools) ? (toolsResult.tools as Tool[]) : []

      this.tools.set(config.name, discoveredTools)

      if (discoveredTools.length > 0) {
        console.log(`[MCP Orchestrator] Discovered ${discoveredTools.length} tools from ${config.name}`)
        this.notifyToolDiscovery()
      } else {
        console.log(`[MCP Orchestrator] No tools discovered from ${config.name} (will retry on first use)`)
      }
      this.notifyToolsUpdated(config.name)
    } catch (_error) {
      // Tool discovery failed but connection succeeded - tools will be discovered on first use
      this.tools.set(config.name, [])
      console.log(`[MCP Orchestrator] Tool discovery deferred for ${config.name} (will discover on first tool call)`)
      this.notifyToolsUpdated(config.name)
    }
  }

  /**
   * Get all discovered tools from all connected MCPs
   */
  getAllTools(): Array<{ mcpName: string; tool: Tool }> {
    const allTools: Array<{ mcpName: string; tool: Tool }> = []

    for (const [mcpName, tools] of this.tools.entries()) {
      for (const tool of tools) {
        allTools.push({ mcpName, tool })
      }
    }

    return allTools
  }

  /**
   * Call a tool on a downstream MCP server
   */
  async callTool(mcpName: string, toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const client = this.clients.get(mcpName)

    if (!client) {
      throw new Error(`MCP client '${mcpName}' not connected`)
    }

    try {
      const result = await client.callTool({
        name: toolName,
        arguments: args
      })

      return result as CallToolResult
    } catch (error) {
      console.error(`[MCP Orchestrator] Error calling ${mcpName}.${toolName}:`, error)
      throw error
    }
  }

  /**
   * Check if a specific MCP is connected
   */
  isConnected(mcpName: string): boolean {
    return this.clients.has(mcpName)
  }

  /**
   * Get list of connected MCP names
   */
  getConnectedMCPs(): string[] {
    return Array.from(this.clients.keys())
  }

  /**
   * Subscribe to tool updates for a specific MCP. Returns an unsubscribe function.
   */
  onToolsUpdated(subscriber: (info: { mcpName: string; tools: Tool[] }) => void): () => void {
    this.toolUpdateSubscribers.push(subscriber)
    return () => {
      this.toolUpdateSubscribers = this.toolUpdateSubscribers.filter((fn) => fn !== subscriber)
    }
  }

  /**
   * Wait for at least one downstream MCP to finish tool discovery, or resolve after a timeout.
   * Prevents registering an empty toolset before downstream servers are ready.
   */
  async waitForInitialTools(timeoutMs: number = 8000): Promise<void> {
    if (this.getAllTools().length > 0) {
      return
    }

    await new Promise<void>((resolve) => {
      let timeoutId: NodeJS.Timeout

      const onDiscovery = () => {
        clearTimeout(timeoutId)
        this.toolDiscoveryListeners = this.toolDiscoveryListeners.filter((listener) => listener !== onDiscovery)
        resolve()
      }

      timeoutId = setTimeout(() => {
        this.toolDiscoveryListeners = this.toolDiscoveryListeners.filter((listener) => listener !== onDiscovery)
        resolve()
      }, timeoutMs)

      this.toolDiscoveryListeners.push(onDiscovery)
    })
  }

  private notifyToolDiscovery(): void {
    if (this.toolDiscoveryListeners.length === 0 || this.getAllTools().length === 0) {
      return
    }

    const listeners = [...this.toolDiscoveryListeners]
    this.toolDiscoveryListeners = []
    for (const listener of listeners) {
      listener()
    }
  }

  private notifyToolsUpdated(mcpName: string): void {
    const tools = this.tools.get(mcpName) ?? []
    for (const subscriber of this.toolUpdateSubscribers) {
      try {
        subscriber({ mcpName, tools })
      } catch (error) {
        console.warn(`[MCP Orchestrator] Tool update subscriber error for ${mcpName}:`, error)
      }
    }
  }

  /**
   * Schedule reconnection for a disconnected MCP
   */
  private scheduleReconnect(mcpName: string): void {
    // Clear any existing reconnect timer
    const existingTimer = this.reconnectTimers.get(mcpName)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    // Schedule reconnection after 3 seconds
    const timer = setTimeout(async () => {
      const config = this.lastConfigs.get(mcpName)
      if (!config) {
        console.warn(`[MCP Orchestrator] No config found for reconnection: ${mcpName}`)
        return
      }

      console.log(`[MCP Orchestrator] Attempting to reconnect to ${mcpName}...`)
      try {
        // Clean up old connection
        const oldTransport = this.transports.get(mcpName)
        if (oldTransport) {
          try {
            await oldTransport.close()
          } catch {
            // Ignore close errors
          }
        }
        this.clients.delete(mcpName)
        this.transports.delete(mcpName)

        // Attempt reconnection
        await this.connectToMCP(config)
        console.log(`[MCP Orchestrator] Successfully reconnected to ${mcpName}`)
      } catch (error) {
        console.warn(`[MCP Orchestrator] Reconnection to ${mcpName} failed:`, error)
        // Schedule another retry
        this.scheduleReconnect(mcpName)
      }
    }, 3000)

    this.reconnectTimers.set(mcpName, timer)
  }

  /**
   * Disconnect all MCP clients
   */
  async disconnect(): Promise<void> {
    // Clear all reconnect timers
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer)
    }
    this.reconnectTimers.clear()

    for (const [name, transport] of this.transports.entries()) {
      try {
        await transport.close()
        console.log(`[MCP Orchestrator] Disconnected from ${name}`)
      } catch (error) {
        console.error(`[MCP Orchestrator] Error disconnecting from ${name}:`, error)
      }
    }

    this.clients.clear()
    this.transports.clear()
    this.tools.clear()
    this.lastConfigs.clear()
  }
}

// Singleton instance
let clientManager: MCPClientManager | null = null

export function getMCPClientManager(): MCPClientManager {
  if (!clientManager) {
    clientManager = new MCPClientManager()
  }
  return clientManager
}
