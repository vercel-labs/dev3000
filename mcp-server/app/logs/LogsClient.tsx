"use client"

import Image from "next/image"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { LogEntry, LogFile, LogListResponse, LogsApiResponse } from "@/types"

// Define interfaces for object property rendering
interface PropertyData {
  name: string
  value: string | number | boolean | null
  type: string
  subtype?: string
}

interface ReplayEvent {
  timestamp: string
  event: string
  details: string
  type?: string
  x?: number
  y?: number
  target?: string
  direction?: string
  distance?: number
  key?: string
}

import { parseLogEntries } from "./utils"

// Hook for dark mode with system preference detection
function useDarkMode() {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      // Check localStorage first
      const saved = localStorage.getItem("dev3000-dark-mode")
      if (saved !== null) {
        return JSON.parse(saved)
      }
      // Default to system preference
      return window.matchMedia("(prefers-color-scheme: dark)").matches
    }
    return false
  })

  useEffect(() => {
    // Save to localStorage
    localStorage.setItem("dev3000-dark-mode", JSON.stringify(darkMode))

    // Apply dark class to document
    if (darkMode) {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
  }, [darkMode])

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = (e: MediaQueryListEvent) => {
      // Only update if no explicit choice has been made
      const saved = localStorage.getItem("dev3000-dark-mode")
      if (saved === null) {
        setDarkMode(e.matches)
      }
    }

    mediaQuery.addEventListener("change", handler)
    return () => mediaQuery.removeEventListener("change", handler)
  }, [])

  return [darkMode, setDarkMode] as const
}

// Keep this for backwards compatibility, but it's not used anymore
function _parseLogLine(line: string): LogEntry | null {
  const match = line.match(/^\[([^\]]+)\] \[([^\]]+)\] (.*)$/s)
  if (!match) return null

  const [, timestamp, source, message] = match
  const screenshot = message.match(/\[SCREENSHOT\] (.+)/)?.[1]

  return {
    timestamp,
    source,
    message,
    screenshot,
    original: line
  }
}

// Component to render truncated URLs with click-to-expand
function URLRenderer({ url, maxLength = 60 }: { url: string; maxLength?: number }) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (url.length <= maxLength) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
      >
        {url}
      </a>
    )
  }

  const truncated = `${url.substring(0, maxLength)}...`

  return (
    <span className="inline-block">
      {isExpanded ? (
        <span>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
          >
            {url}
          </a>
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            className="ml-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 px-1 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            [collapse]
          </button>
        </span>
      ) : (
        <span>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
          >
            {truncated}
          </a>
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="ml-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 px-1 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            [expand]
          </button>
        </span>
      )}
    </span>
  )
}

// Component to render Chrome DevTools-style collapsible objects
function ObjectRenderer({ content }: { content: string }) {
  const [isExpanded, setIsExpanded] = useState(false)

  try {
    const obj = JSON.parse(content)

    // Check if it's a Chrome DevTools object representation
    if (obj && typeof obj === "object" && obj.type === "object" && obj.properties) {
      const properties = obj.properties
      const description = obj.description || "Object"
      const overflow = obj.overflow

      return (
        <div className="inline-block">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-mono text-sm"
          >
            <svg
              className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 111.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-purple-600">{description}</span>
            {!isExpanded && (
              <span className="text-gray-500">
                {overflow ? "..." : ""} {"{"}
                {properties.slice(0, 3).map((prop: PropertyData, idx: number) => (
                  <span key={`${prop.name}-${idx}`}>
                    {idx > 0 && ", "}
                    <span className="text-red-600">{prop.name}</span>:
                    <span className="text-blue-600">
                      {prop.type === "string"
                        ? `"${prop.value}"`
                        : prop.type === "number"
                          ? prop.value
                          : prop.type === "object"
                            ? prop.subtype === "array"
                              ? prop.value
                              : "{...}"
                            : prop.value}
                    </span>
                  </span>
                ))}
                {properties.length > 3 && ", ..."}
                {"}"}
              </span>
            )}
          </button>

          {isExpanded && (
            <div className="mt-1 ml-4 border-l-2 border-gray-200 pl-3">
              <div className="font-mono text-sm">
                <div className="text-gray-600">
                  {description} {"{"}
                  <div className="ml-4">
                    {properties.map((prop: PropertyData, idx: number) => (
                      <div key={`${prop.name}-${idx}`} className="py-0.5">
                        <span className="text-red-600">{prop.name}</span>
                        <span className="text-gray-500">: </span>
                        <span
                          className={
                            prop.type === "string"
                              ? "text-green-600"
                              : prop.type === "number"
                                ? "text-blue-600"
                                : prop.type === "object"
                                  ? "text-purple-600"
                                  : "text-orange-600"
                          }
                        >
                          {prop.type === "string"
                            ? `"${String(prop.value)}"`
                            : prop.type === "number"
                              ? String(prop.value)
                              : prop.type === "object"
                                ? prop.subtype === "array"
                                  ? String(prop.value)
                                  : "{...}"
                                : String(prop.value)}
                        </span>
                        {idx < properties.length - 1 && <span className="text-gray-500">,</span>}
                      </div>
                    ))}
                    {overflow && <div className="text-gray-500 italic">... and more properties</div>}
                  </div>
                  <div className="text-gray-600">{"}"}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )
    }

    // For regular JSON objects, render them nicely too
    return (
      <div className="inline-block">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-mono text-sm"
        >
          <svg
            className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 111.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-purple-600">Object</span>
          {!isExpanded && (
            <span className="text-gray-500">
              {"{"}...{"}"}
            </span>
          )}
        </button>

        {isExpanded && (
          <div className="mt-1 ml-4 border-l-2 border-gray-200 pl-3">
            <pre className="font-mono text-sm text-gray-700 whitespace-pre-wrap">{JSON.stringify(obj, null, 2)}</pre>
          </div>
        )}
      </div>
    )
  } catch (_e) {
    // If it's not valid JSON, just return the original content
    return <span>{content}</span>
  }
}

function LogEntryComponent({ entry }: { entry: LogEntry }) {
  // Parse log type from message patterns with dark mode support
  const parseLogType = (message: string) => {
    if (message.includes("[INTERACTION]"))
      return {
        type: "INTERACTION",
        color: "bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800",
        tag: "bg-purple-100 dark:bg-purple-800 text-purple-800 dark:text-purple-200"
      }
    if (message.includes("[CONSOLE ERROR]"))
      return {
        type: "ERROR",
        color: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800",
        tag: "bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-200"
      }
    if (message.includes("[CONSOLE WARN]"))
      return {
        type: "WARNING",
        color: "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800",
        tag: "bg-yellow-100 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200"
      }
    if (message.includes("[SCREENSHOT]"))
      return {
        type: "SCREENSHOT",
        color: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800",
        tag: "bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200"
      }
    if (message.includes("[NAVIGATION]"))
      return {
        type: "NAVIGATION",
        color: "bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800",
        tag: "bg-indigo-100 dark:bg-indigo-800 text-indigo-800 dark:text-indigo-200"
      }
    if (message.includes("[NETWORK ERROR]"))
      return {
        type: "NETWORK",
        color: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800",
        tag: "bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-200"
      }
    if (message.includes("[NETWORK REQUEST]"))
      return {
        type: "NETWORK",
        color: "bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700",
        tag: "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
      }
    if (message.includes("[PAGE ERROR]"))
      return {
        type: "ERROR",
        color: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800",
        tag: "bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-200"
      }
    return {
      type: "DEFAULT",
      color: "border-gray-200 dark:border-gray-700",
      tag: "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
    }
  }

  const logTypeInfo = parseLogType(entry.message)

  // Extract and highlight type tags, detect JSON objects and URLs
  const renderMessage = (message: string) => {
    const typeTagRegex = /\[([A-Z\s]+)\]/g
    const jsonRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g
    const urlRegex = /(https?:\/\/[^\s]+)/g

    const parts = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    // First, handle type tags
    match = typeTagRegex.exec(message)
    while (match !== null) {
      // Add text before the tag
      if (match.index > lastIndex) {
        parts.push(message.slice(lastIndex, match.index))
      }

      // Add the tag with styling
      parts.push(
        <span
          key={match.index}
          className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${logTypeInfo.tag} mr-1`}
        >
          {match[1]}
        </span>
      )

      lastIndex = match.index + match[0].length
      match = typeTagRegex.exec(message)
    }

    // Add remaining text
    const remainingText = message.slice(lastIndex)

    // Process remaining text for JSON objects and URLs
    const processTextForObjects = (text: string, keyPrefix: string) => {
      const jsonMatches = [...text.matchAll(jsonRegex)]
      const urlMatches = [...text.matchAll(urlRegex)]
      const allMatches = [
        ...jsonMatches.map((m) => ({ ...m, type: "json" })),
        ...urlMatches.map((m) => ({ ...m, type: "url" }))
      ]

      // Sort matches by index
      allMatches.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))

      if (allMatches.length === 0) {
        return [text]
      }

      const finalParts = []
      let textLastIndex = 0

      allMatches.forEach((objMatch, _idx) => {
        // Add text before match
        if ((objMatch.index ?? 0) > textLastIndex) {
          finalParts.push(text.slice(textLastIndex, objMatch.index ?? 0))
        }

        // Add appropriate renderer
        if (objMatch.type === "json") {
          finalParts.push(
            <ObjectRenderer
              key={`${keyPrefix}-json-${objMatch.index}-${objMatch[0].slice(0, 20)}`}
              content={objMatch[0]}
            />
          )
        } else if (objMatch.type === "url") {
          finalParts.push(<URLRenderer key={`${keyPrefix}-url-${objMatch.index}-${objMatch[0]}`} url={objMatch[0]} />)
        }

        textLastIndex = (objMatch.index ?? 0) + objMatch[0].length
      })

      // Add any text after the last match
      if (textLastIndex < text.length) {
        finalParts.push(text.slice(textLastIndex))
      }

      return finalParts
    }

    const processedRemaining = processTextForObjects(remainingText, "main")
    parts.push(...processedRemaining)

    return parts.length > 0 ? parts : message
  }

  return (
    <div className={`border-l-4 ${logTypeInfo.color} pl-4 py-2`}>
      {/* Table-like layout using CSS Grid */}
      <div className="grid grid-cols-[auto_auto_1fr] gap-3 items-start">
        {/* Column 1: Timestamp */}
        <div className="text-xs text-gray-500 dark:text-gray-400 font-mono whitespace-nowrap pt-1">
          {new Date(entry.timestamp).toLocaleTimeString()}
        </div>

        {/* Column 2: Source */}
        <div
          className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${
            entry.source === "SERVER"
              ? "bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200"
              : "bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-200"
          }`}
        >
          {entry.source}
        </div>

        {/* Column 3: Message content with user agent info */}
        <div className="font-mono text-sm min-w-0 text-gray-900 dark:text-gray-100">
          <div className="flex flex-wrap items-start gap-2">
            <div className="flex-1 min-w-0">{renderMessage(entry.message)}</div>
            {/* User Agent and Tab Identifier Pills */}
            <div className="flex items-center gap-1 flex-shrink-0">
              {entry.tabIdentifier && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                  {entry.tabIdentifier}
                </span>
              )}
              {entry.userAgent && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-800 text-green-700 dark:text-green-200">
                  {entry.userAgent.includes("Chrome")
                    ? "Chrome"
                    : entry.userAgent.includes("Firefox")
                      ? "Firefox"
                      : entry.userAgent.includes("Safari")
                        ? "Safari"
                        : entry.userAgent.includes("Edge")
                          ? "Edge"
                          : "Browser"}
                </span>
              )}
              {/* Browser Type Pill (Chrome Extension vs Playwright) - only show if browser source */}
              {entry.source === "BROWSER" &&
                (() => {
                  const isPlaywright = entry.message.includes("[PLAYWRIGHT]")
                  const isChromeExtension = entry.message.includes("[CHROME_EXTENSION]") || entry.tabIdentifier // Tab identifier indicates Chrome Extension

                  if (isPlaywright) {
                    return (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 dark:bg-purple-800 text-purple-700 dark:text-purple-200">
                        🎭 Playwright
                      </span>
                    )
                  } else if (isChromeExtension) {
                    return (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-200">
                        🧩 Extension
                      </span>
                    )
                  }
                  return null
                })()}
              {/* Server Framework Pill - only show if server source */}
              {entry.source === "SERVER" &&
                (() => {
                  const message = entry.message.toLowerCase()

                  // Next.js - look for Next.js specific patterns
                  if (
                    message.includes("ready on http://localhost") ||
                    message.includes("ready in ") ||
                    message.includes("next.js") ||
                    message.includes("compiled client and server")
                  ) {
                    return (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-black text-white">
                        ▲ Next.js
                      </span>
                    )
                  }

                  // Nuxt.js - look for Nuxt specific patterns
                  else if (
                    message.includes("nuxt") ||
                    (message.includes("nitro") && message.includes("http://localhost")) ||
                    message.includes("universal mode") ||
                    message.includes("spa mode")
                  ) {
                    return (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-500 text-white">
                        💚 Nuxt
                      </span>
                    )
                  }

                  // Vue CLI/Vite + Vue - look for Vue specific patterns
                  else if (
                    message.includes("vue-cli-service") ||
                    (message.includes("vue") && (message.includes("dev server") || message.includes("local:"))) ||
                    message.includes("@vue/cli-service")
                  ) {
                    return (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-600 text-white">
                        🟢 Vue
                      </span>
                    )
                  }

                  // Vite (generic) - look for Vite patterns
                  else if (
                    (message.includes("local:") && message.includes("vite")) ||
                    message.includes("dev server running") ||
                    message.includes("vite v")
                  ) {
                    return (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-500 text-white">
                        ⚡ Vite
                      </span>
                    )
                  }

                  // Ruby on Rails - look for Rails patterns
                  else if (
                    message.includes("rails server") ||
                    message.includes("puma starting") ||
                    message.includes("use ctrl-c to stop") ||
                    (message.includes("listening on tcp://") && message.includes("3000"))
                  ) {
                    return (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-600 text-white">
                        💎 Rails
                      </span>
                    )
                  }

                  // Laravel - look for Laravel/Artisan patterns
                  else if (
                    message.includes("laravel development server") ||
                    message.includes("artisan serve") ||
                    (message.includes("laravel") && message.includes("127.0.0.1:8000"))
                  ) {
                    return (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-500 text-white">
                        🅻 Laravel
                      </span>
                    )
                  }

                  // Express.js/Node.js - look for Express patterns
                  else if (
                    message.includes("express server") ||
                    message.includes("server listening on") ||
                    message.includes("app listening on port") ||
                    message.includes("node server")
                  ) {
                    return (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-700 text-white">
                        🟩 Express
                      </span>
                    )
                  }

                  // Django - look for Django patterns
                  else if (
                    message.includes("django") ||
                    (message.includes("development server") && message.includes("127.0.0.1:8000")) ||
                    message.includes("runserver")
                  ) {
                    return (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-800 text-white">
                        🐍 Django
                      </span>
                    )
                  }

                  // Flask - look for Flask patterns
                  else if (
                    message.includes("flask") ||
                    message.includes("running on http://127.0.0.1:5000") ||
                    message.includes("debug mode: on")
                  ) {
                    return (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-800 text-white">
                        🌶️ Flask
                      </span>
                    )
                  }

                  // Svelte/SvelteKit - look for Svelte patterns
                  else if (
                    message.includes("sveltekit") ||
                    (message.includes("svelte") && message.includes("dev")) ||
                    message.includes("@sveltejs")
                  ) {
                    return (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-orange-500 text-white">
                        🔥 Svelte
                      </span>
                    )
                  }

                  // Remix - look for Remix patterns
                  else if (message.includes("remix") || message.includes("@remix-run")) {
                    return (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-400 text-white">
                        💿 Remix
                      </span>
                    )
                  }

                  // Astro - look for Astro patterns
                  else if (message.includes("astro") || message.includes("@astrojs")) {
                    return (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-600 text-white">
                        🚀 Astro
                      </span>
                    )
                  }

                  // Spring Boot - look for Spring patterns
                  else if (
                    message.includes("spring boot") ||
                    message.includes("tomcat started on port") ||
                    (message.includes("started application") && message.includes("seconds"))
                  ) {
                    return (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-500 text-white">
                        🍃 Spring
                      </span>
                    )
                  }

                  // Generic React (CRA, webpack-dev-server) - fallback for React patterns
                  else if (
                    message.includes("webpack compiled") ||
                    message.includes("compiled successfully") ||
                    message.includes("webpack-dev-server")
                  ) {
                    return (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-600 text-white">
                        ⚛️ React
                      </span>
                    )
                  }

                  return null
                })()}
            </div>
          </div>
        </div>
      </div>

      {entry.screenshot && (
        <div className="mt-2">
          <Image
            src={`/screenshots/${entry.screenshot}`}
            alt="Screenshot"
            width={0}
            height={0}
            sizes="100vw"
            className="w-full h-auto max-w-2xl border rounded shadow-sm"
            style={{ maxHeight: "600px", objectFit: "contain" }}
            unoptimized
          />
        </div>
      )}
    </div>
  )
}

interface LogsClientProps {
  version: string
  initialData?: {
    logs: LogEntry[]
    logFiles: LogFile[]
    currentLogFile: string
    mode: "head" | "tail"
  }
}

export default function LogsClient({ version, initialData }: LogsClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [darkMode, setDarkMode] = useDarkMode()
  const [logs, setLogs] = useState<LogEntry[]>(initialData?.logs || [])
  const [mode, setMode] = useState<"head" | "tail">(initialData?.mode || "tail")

  // Update mode when URL parameters change
  useEffect(() => {
    const urlMode = searchParams.get("mode") as "head" | "tail" | null
    if (urlMode && urlMode !== mode) {
      setMode(urlMode)
    }
  }, [searchParams, mode])
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [isInitialLoading, setIsInitialLoading] = useState(!initialData)
  const [lastLogCount, setLastLogCount] = useState(initialData?.logs.length || 0)
  const [lastFetched, setLastFetched] = useState<Date | null>(null)
  const [availableLogs, setAvailableLogs] = useState<LogFile[]>(initialData?.logFiles || [])
  const [currentLogFile, setCurrentLogFile] = useState<string>(initialData?.currentLogFile || "")
  const [projectName, setProjectName] = useState<string>("")
  const [showLogSelector, setShowLogSelector] = useState(false)
  const [isReplaying, setIsReplaying] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [showReplayPreview, setShowReplayPreview] = useState(false)
  const [replayEvents, setReplayEvents] = useState<ReplayEvent[]>([])
  const [isRotatingLog, setIsRotatingLog] = useState(false)
  const [filters, setFilters] = useState({
    browser: true,
    server: true,
    interaction: true,
    screenshot: true
  })
  const [userAgentFilters, setUserAgentFilters] = useState<Record<string, boolean>>({})
  const [logBuffer, setLogBuffer] = useState<LogEntry[]>([]) // Buffer logs when not in live mode
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const filterDropdownRef = useRef<HTMLDivElement>(null)
  const userScrolledManually = useRef<boolean>(false) // Track if user manually scrolled away from live mode

  const loadAvailableLogs = useCallback(async () => {
    try {
      const response = await fetch("/api/logs/list")
      if (response.ok) {
        const data: LogListResponse = await response.json()
        setAvailableLogs(data.files)
        setCurrentLogFile(data.currentFile)
        setProjectName(data.projectName)
      }
    } catch (error) {
      console.error("Error loading available logs:", error)
    }
  }, [])

  const pollForNewLogs = useCallback(async () => {
    if (mode !== "tail") return

    try {
      // Determine which log file to poll
      const requestedFile = searchParams.get("file")
      let logPath = ""
      let isCurrentFile = true

      if (requestedFile && availableLogs.length > 0) {
        // Find the specific log file requested
        const foundFile = availableLogs.find((f) => f.name === requestedFile)
        logPath = foundFile?.path || currentLogFile
        isCurrentFile = foundFile?.isCurrent !== false
      } else {
        // Use current log file
        logPath = currentLogFile
        isCurrentFile = true
      }

      // Only poll for new logs if viewing the current (active) log file
      if (!isCurrentFile) return

      // Build API URL with logPath parameter if needed
      // For polling, only fetch a small number of new lines to reduce server load
      const apiUrl = logPath
        ? `/api/logs/tail?lines=50&logPath=${encodeURIComponent(logPath)}`
        : `/api/logs/tail?lines=50`

      const response = await fetch(apiUrl)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data: LogsApiResponse = await response.json()

      if (!data.logs) {
        console.warn("No logs data in response")
        return
      }

      const entries = parseLogEntries(data.logs)

      if (entries.length > lastLogCount) {
        if (isAtBottom) {
          // In live mode - apply logs immediately and flush buffer
          setLastFetched(new Date()) // Only update "Last updated" when actually showing new logs

          if (logBuffer.length > 0) {
            // Merge buffer with latest entries
            setLogs([...logs, ...logBuffer, ...entries.slice(lastLogCount)])
            setLogBuffer([]) // Clear buffer
          } else {
            setLogs(entries)
          }
          setLastLogCount(entries.length)

          // Auto-scroll to bottom - but only if user hasn't manually scrolled away
          if (!userScrolledManually.current) {
            setTimeout(() => {
              bottomRef.current?.scrollIntoView({ behavior: "smooth" })
            }, 50)
          }
        } else {
          // Not in live mode - buffer the new entries (don't update "Last updated")
          const newEntries = entries.slice(lastLogCount)
          if (newEntries.length > 0) {
            setLogBuffer((prev) => [...prev, ...newEntries])
            setLastLogCount(entries.length)
          }
        }
      }
    } catch (error) {
      console.error("Error polling logs:", error)
      // Don't spam console on network errors during polling
    }
  }, [mode, isAtBottom, searchParams, availableLogs, currentLogFile, lastLogCount, logBuffer, logs])

  // Start/stop polling based on mode (always poll in tail mode, but buffer when not at bottom)
  useEffect(() => {
    if (mode === "tail") {
      pollIntervalRef.current = setInterval(pollForNewLogs, 3000) // Poll every 3 seconds
      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
        }
      }
    } else {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [mode, pollForNewLogs]) // Removed isAtBottom - now always poll in tail mode

  // Handle returning to live mode - ONLY flush buffer when user explicitly clicks "Live" button
  // This effect is removed to prevent race conditions - buffer flushing now happens only on explicit user action

  const loadInitialLogs = useCallback(async () => {
    setIsInitialLoading(true)

    // Load available logs list first
    await loadAvailableLogs()

    try {
      // Determine which log file to load
      const requestedFile = searchParams.get("file")
      let logPath = ""

      if (requestedFile && availableLogs.length > 0) {
        // Find the specific log file requested
        const foundFile = availableLogs.find((f) => f.name === requestedFile)
        logPath = foundFile?.path || currentLogFile
      } else {
        // Use current log file
        logPath = currentLogFile
      }

      // Build API URL with logPath parameter if needed
      const apiUrl = logPath
        ? `/api/logs/${mode}?lines=1000&logPath=${encodeURIComponent(logPath)}`
        : `/api/logs/${mode}?lines=1000`

      const response = await fetch(apiUrl)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data: LogsApiResponse = await response.json()

      if (!data.logs) {
        console.warn("No logs data in response")
        setLogs([])
        setIsInitialLoading(false)
        return
      }

      const entries = parseLogEntries(data.logs)

      setLogs(entries)
      setLastLogCount(entries.length)
      setLastFetched(new Date())
      setIsInitialLoading(false)

      // Auto-scroll to bottom for tail mode - only if user hasn't manually scrolled away
      if (mode === "tail" && !userScrolledManually.current) {
        setIsAtBottom(true)
        const scrollToBottom = () => {
          if (bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: "auto" })
          } else if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight
          }
        }
        // Try multiple times to ensure it works
        setTimeout(scrollToBottom, 0)
        setTimeout(scrollToBottom, 100)
      }
    } catch (error) {
      console.error("Error loading logs:", error)
      setLogs([])
    }
  }, [loadAvailableLogs, searchParams, availableLogs, currentLogFile, mode])

  useEffect(() => {
    // Only load logs if we don't have initial data or mode actually changed
    const _currentMode = searchParams.get("mode") || "tail"
    const hasInitialData = initialData?.logs && initialData?.logs.length > 0

    if (!hasInitialData && !logs.length) {
      // No server-side data and no client data - load fresh
      loadInitialLogs()
    } else if (hasInitialData && logs.length === 0) {
      // We have server-side data but client state is empty - use server data
      setLogs(initialData.logs)
      setIsInitialLoading(false)
      if (mode === "tail" && !userScrolledManually.current) {
        // Scroll to bottom for tail mode with server data - only if user hasn't manually scrolled away
        setIsAtBottom(true)
        const scrollToBottom = () => {
          if (bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: "auto" })
          } else if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight
          }
        }
        // Try multiple times to ensure it works
        setTimeout(scrollToBottom, 0)
        setTimeout(scrollToBottom, 100)
        setTimeout(scrollToBottom, 300)
      }
    } else if (mode === "tail" && isAtBottom) {
      // Set up polling timer for new logs if we're in tail mode
      setIsInitialLoading(false)
      pollIntervalRef.current = setInterval(() => {
        pollForNewLogs()
      }, 3000)
    }
  }, [
    mode,
    initialData?.logs,
    isAtBottom, // No server-side data and no client data - load fresh
    loadInitialLogs,
    logs.length,
    pollForNewLogs,
    searchParams.get
  ]) // Only depend on mode to avoid infinite loops

  // Separate effect to handle scrolling after logs are rendered
  useEffect(() => {
    if (logs.length > 0 && mode === "tail" && isAtBottom && !userScrolledManually.current) {
      const scrollToBottom = () => {
        if (bottomRef.current) {
          bottomRef.current.scrollIntoView({ behavior: "auto" })
        } else if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight
        }
      }
      // Scroll after DOM updates
      setTimeout(scrollToBottom, 0)
    }
  }, [logs.length, mode, isAtBottom]) // Trigger when logs are actually rendered

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [])

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowLogSelector(false)
      }
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) {
        setShowFilters(false)
      }
    }

    if (showLogSelector || showFilters) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [showLogSelector, showFilters])

  const handleScroll = () => {
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current
      const atBottom = scrollTop + clientHeight >= scrollHeight - 10

      // If user scrolled up from the bottom, mark as manual scroll
      if (isAtBottom && !atBottom) {
        userScrolledManually.current = true
      }

      // If user scrolled back to bottom, clear manual scroll flag only via explicit action
      // (not automatically - they need to click the "Live" button)

      setIsAtBottom(atBottom)
    }
  }

  const handleReplay = async () => {
    if (isReplaying) return

    setIsReplaying(true)

    try {
      // Get replay data from logs
      const response = await fetch("/api/replay?action=parse")
      if (!response.ok) {
        throw new Error("Failed to parse replay data")
      }

      const replayData = await response.json()

      if (replayData.interactions.length === 0) {
        alert("No user interactions found in logs to replay")
        return
      }

      // Generate CDP commands for replay
      const response2 = await fetch("/api/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "execute",
          replayData: replayData,
          speed: 2
        })
      })

      const result = await response2.json()

      if (result.success) {
        console.log("Replay executed successfully:", result)
        alert(`Replay completed! Executed ${result.totalCommands} commands.`)
      } else {
        console.log("CDP execution failed, showing commands:", result)
        alert(
          `CDP execution not available. Generated ${result.commands?.length || 0} commands. Check console for details.`
        )
      }
    } catch (error) {
      console.error("Replay error:", error)
      alert(`Failed to start replay: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      setIsReplaying(false)
    }
  }

  const loadReplayPreview = () => {
    // Extract interactions from current logs instead of making API call
    const interactions = logs
      .filter((log) => log.message.includes("[INTERACTION]"))
      .map((log) => {
        const match = log.message.match(/\[INTERACTION\] (.+)/)
        if (match) {
          try {
            // Try parsing as JSON (new format)
            const data = JSON.parse(match[1])
            return {
              timestamp: log.timestamp,
              event: data.type || "unknown",
              details: JSON.stringify(data),
              type: data.type,
              x: data.x,
              y: data.y,
              target: data.target,
              direction: data.direction,
              distance: data.distance,
              key: data.key
            } as ReplayEvent
          } catch {
            // Fallback to old format parsing
            const oldMatch = match[1].match(/(CLICK|TAP|SCROLL|KEY) (.+)/)
            if (oldMatch) {
              return {
                timestamp: log.timestamp,
                event: oldMatch[1],
                details: oldMatch[2],
                type: oldMatch[1]
              } as ReplayEvent
            }
          }
        }
        return null
      })
      .filter((item): item is ReplayEvent => item !== null)

    setReplayEvents(interactions)
  }

  const handleRotateLog = async () => {
    if (!currentLogFile || isRotatingLog) return

    const confirmed = window.confirm(
      "Clear logs and start fresh?\n\n" +
        "This will:\n" +
        "• Archive the current log file\n" +
        "• Start a new empty log file\n" +
        "• Clear the current view\n\n" +
        "The archived logs will still be available in the dropdown."
    )

    if (!confirmed) return

    setIsRotatingLog(true)
    try {
      const response = await fetch("/api/logs/rotate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ currentLogPath: currentLogFile })
      })

      if (response.ok) {
        // Clear current logs from UI
        setLogs([])
        setLastLogCount(0)
        setLastFetched(null)

        // Reload available logs to show the new archived file
        await loadAvailableLogs()

        // Start fresh polling
        await loadInitialLogs()
      } else {
        const error = await response.json()
        console.error("Failed to rotate log:", error)
        alert(`Failed to rotate log: ${error.error}`)
      }
    } catch (error) {
      console.error("Error rotating log:", error)
      alert("Error rotating log")
    } finally {
      setIsRotatingLog(false)
    }
  }

  // Compute available user agents from browser logs
  const availableUserAgents = useMemo(() => {
    const userAgents = new Set<string>()
    logs.forEach((entry) => {
      if (entry.source === "BROWSER" && entry.userAgent) {
        userAgents.add(entry.userAgent)
      }
    })
    return Array.from(userAgents).sort()
  }, [logs])

  // Update user agent filters when available user agents change
  useEffect(() => {
    if (availableUserAgents.length > 0) {
      setUserAgentFilters((prev) => {
        const newFilters = { ...prev }
        // Enable all user agents by default if not already set
        availableUserAgents.forEach((ua) => {
          if (!(ua in newFilters)) {
            newFilters[ua] = true
          }
        })
        return newFilters
      })
    }
  }, [availableUserAgents])

  const filteredLogs = useMemo(() => {
    return logs.filter((entry) => {
      // Check specific message types first (these override source filtering)
      const isInteraction = entry.message.includes("[INTERACTION]")
      const isScreenshot = entry.message.includes("[SCREENSHOT]")

      if (isInteraction) return filters.interaction
      if (isScreenshot) return filters.screenshot

      // For other logs, filter by source
      if (entry.source === "SERVER") return filters.server
      if (entry.source === "BROWSER") {
        // First check if browser logs are enabled at all
        if (!filters.browser) return false

        // If there are user agent filters and this entry has a user agent, apply UA filtering
        if (availableUserAgents.length > 0 && entry.userAgent) {
          return userAgentFilters[entry.userAgent] !== false
        }

        // Otherwise, just show if browser is enabled
        return true
      }

      return true
    })
  }, [logs, filters, userAgentFilters, availableUserAgents])

  return (
    <div className="h-screen bg-gray-50 dark:bg-gray-900 flex flex-col transition-colors">
      {/* Header - Fixed */}
      <div className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 flex-none z-10">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-4">
              <div className="flex items-center gap-1">
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white whitespace-nowrap">
                  dev3000
                </h1>
                <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">(v{version})</span>
              </div>
              {/* Log File Selector */}
              {availableLogs.length > 1 ? (
                <div className="relative" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => setShowLogSelector(!showLogSelector)}
                    className="flex items-center gap-2 px-3 py-1 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-700 rounded-md transition-colors"
                  >
                    <span className="font-mono text-xs whitespace-nowrap">
                      {isInitialLoading && !currentLogFile ? (
                        <div
                          className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"
                          style={{ width: "220px" }}
                        />
                      ) : currentLogFile ? (
                        // Show basename for all files
                        currentLogFile
                          .split("/")
                          .pop()
                      ) : (
                        "No log file"
                      )}
                    </span>
                    <svg
                      className={`w-4 h-4 transition-transform ${showLogSelector ? "rotate-180" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {/* Dropdown */}
                  {showLogSelector && availableLogs.length > 1 && (
                    <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md shadow-lg z-20 min-w-80">
                      <div className="py-1 max-h-60 overflow-y-auto">
                        <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                          {projectName} logs ({availableLogs.length})
                        </div>
                        {availableLogs.map((logFile) => (
                          <button
                            type="button"
                            key={logFile.path}
                            onClick={() => {
                              setShowLogSelector(false)
                              router.push(`/logs?file=${encodeURIComponent(logFile.name)}&mode=${mode}`)
                            }}
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between ${
                              logFile.isCurrent ? "bg-blue-50 text-blue-900" : "text-gray-700"
                            }`}
                          >
                            <div className="flex flex-col">
                              <span className="font-mono text-xs">{logFile.name}</span>
                              <span className="text-xs text-gray-500">
                                {new Date(logFile.mtime).toLocaleString()} • {Math.round(logFile.size / 1024)}KB
                              </span>
                            </div>
                            {logFile.isCurrent && <span className="text-xs text-blue-600 font-medium">current</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-gray-600 px-3 py-1 whitespace-nowrap">
                    {isInitialLoading && !currentLogFile ? (
                      <div className="h-4 bg-gray-200 rounded animate-pulse" style={{ width: "220px" }} />
                    ) : currentLogFile ? (
                      // Show basename for all files
                      currentLogFile
                        .split("/")
                        .pop()
                    ) : (
                      "No log file"
                    )}
                  </span>
                </div>
              )}

              {/* Entries count */}
              {logs.length > 0 && <span className="text-sm text-gray-500 hidden sm:inline">{logs.length} entries</span>}

              {/* Buffered logs indicator */}
              {logBuffer.length > 0 && !isAtBottom && (
                <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-1 rounded-full">
                  +{logBuffer.length} buffered
                </span>
              )}

              {/* Clear button - always visible when we have a current log file */}
              {currentLogFile && !isInitialLoading && (
                <button
                  type="button"
                  onClick={handleRotateLog}
                  disabled={isRotatingLog}
                  className="px-2 py-1 text-xs bg-orange-100 text-orange-700 hover:bg-orange-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Clear logs (rotate current log to archive and start fresh)"
                >
                  {isRotatingLog ? "..." : "Clear"}
                </button>
              )}
            </div>

            {/* Mode Toggle */}
            <div className="flex items-center gap-2">
              {/* Replay Button - Hidden until functionality is complete */}
              {false && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={handleReplay}
                    disabled={isReplaying}
                    onMouseEnter={() => {
                      if (!isReplaying) {
                        loadReplayPreview()
                        setShowReplayPreview(true)
                      }
                    }}
                    onMouseLeave={() => setShowReplayPreview(false)}
                    className={`flex items-center gap-1 px-3 py-1 rounded text-sm font-medium transition-colors whitespace-nowrap ${
                      isReplaying
                        ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                        : "bg-purple-100 text-purple-800 hover:bg-purple-200"
                    }`}
                  >
                    {isReplaying ? (
                      <>
                        <div className="w-3 h-3 border border-purple-300 border-t-purple-600 rounded-full animate-spin"></div>
                        Replaying...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h1m4 0h1m6-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M7 7V4a1 1 0 011-1h4a1 1 0 011 1v3m-9 4h16m-5 4v1a1 1 0 01-1 1H8a1 1 0 01-1-1v-1m8 0V9a1 1 0 00-1-1H8a1 1 0 00-1 1v8.001"
                          />
                        </svg>
                        Replay
                      </>
                    )}
                  </button>
                  {/* Replay Preview Dropdown */}
                  {showReplayPreview && !isReplaying && (
                    <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-30 w-80">
                      <div className="py-2">
                        <div className="px-3 py-2 text-xs font-medium text-gray-500 border-b">
                          Replay Events ({replayEvents.length})
                        </div>
                        <div className="max-h-60 overflow-y-auto">
                          {replayEvents.length === 0 ? (
                            <div className="px-3 py-4 text-sm text-gray-500 text-center">No interactions to replay</div>
                          ) : (
                            replayEvents.map((event, index) => (
                              <div
                                key={`${event.timestamp}-${index}`}
                                className="px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                              >
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                      event.type === "CLICK"
                                        ? "bg-blue-100 text-blue-800"
                                        : event.type === "SCROLL"
                                          ? "bg-green-100 text-green-800"
                                          : "bg-gray-100 text-gray-700"
                                    }`}
                                  >
                                    {event.type}
                                  </span>
                                  <span className="text-xs text-gray-500 font-mono">
                                    {new Date(event.timestamp).toLocaleTimeString()}
                                  </span>
                                </div>
                                <div className="mt-1 text-xs text-gray-600 font-mono truncate">
                                  {event.type === "CLICK" && `(${event.x}, ${event.y}) on ${event.target}`}
                                  {event.type === "SCROLL" &&
                                    `${event.direction} ${event.distance}px to (${event.x}, ${event.y})`}
                                  {event.type === "KEY" && `${event.key} in ${event.target}`}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* Filter Button */}
              <div className="relative" ref={filterDropdownRef}>
                <button
                  type="button"
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex items-center gap-1 px-3 py-1 rounded text-sm font-medium transition-colors whitespace-nowrap bg-gray-100 text-gray-700 hover:bg-gray-200"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                    />
                  </svg>
                  Filter
                </button>
                {/* Filter Dropdown */}
                {showFilters && (
                  <div className="absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-20 min-w-48">
                    <div className="py-2">
                      <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                        Log Types
                      </div>

                      {/* Server Logs */}
                      <label className="flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={filters.server}
                            onChange={(e) =>
                              setFilters((prev) => ({
                                ...prev,
                                server: e.target.checked
                              }))
                            }
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-gray-900 dark:text-gray-100">Server</span>
                        </div>
                        <span className="text-xs text-gray-400">
                          {logs.filter((l) => l.source === "SERVER").length}
                        </span>
                      </label>

                      {/* Browser Logs */}
                      <label className="flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={filters.browser}
                            onChange={(e) =>
                              setFilters((prev) => ({
                                ...prev,
                                browser: e.target.checked
                              }))
                            }
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-gray-900 dark:text-gray-100">Browser</span>
                        </div>
                        <span className="text-xs text-gray-400">
                          {logs.filter((l) => l.source === "BROWSER").length}
                        </span>
                      </label>

                      {/* User Agent Sub-filters */}
                      {availableUserAgents.length > 1 && filters.browser && (
                        <div className="ml-6 border-l border-gray-200 dark:border-gray-600 pl-2">
                          {availableUserAgents.map((ua) => {
                            const shortUA = ua.includes("Chrome")
                              ? "Chrome"
                              : ua.includes("Firefox")
                                ? "Firefox"
                                : ua.includes("Safari")
                                  ? "Safari"
                                  : ua.includes("Edge")
                                    ? "Edge"
                                    : "Browser"
                            return (
                              <label
                                key={ua}
                                className="flex items-center justify-between px-2 py-1 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                              >
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={userAgentFilters[ua] !== false}
                                    onChange={(e) =>
                                      setUserAgentFilters((prev) => ({
                                        ...prev,
                                        [ua]: e.target.checked
                                      }))
                                    }
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-3 h-3"
                                  />
                                  <span className="text-gray-700 dark:text-gray-300">{shortUA}</span>
                                </div>
                                <span className="text-xs text-gray-400">
                                  {logs.filter((l) => l.source === "BROWSER" && l.userAgent === ua).length}
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      )}

                      {/* Interaction Logs */}
                      <label className="flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={filters.interaction}
                            onChange={(e) =>
                              setFilters((prev) => ({
                                ...prev,
                                interaction: e.target.checked
                              }))
                            }
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-gray-900 dark:text-gray-100">Interaction</span>
                        </div>
                        <span className="text-xs text-gray-400">
                          {logs.filter((l) => l.message.includes("[INTERACTION]")).length}
                        </span>
                      </label>

                      {/* Screenshot Logs */}
                      <label className="flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={filters.screenshot}
                            onChange={(e) =>
                              setFilters((prev) => ({
                                ...prev,
                                screenshot: e.target.checked
                              }))
                            }
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-gray-900 dark:text-gray-100">Screenshot</span>
                        </div>
                        <span className="text-xs text-gray-400">
                          {logs.filter((l) => l.message.includes("[SCREENSHOT]")).length}
                        </span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center bg-gray-100 rounded-md p-1">
                <button
                  type="button"
                  onClick={() => {
                    const currentFile = searchParams.get("file")
                    if (currentFile) {
                      router.push(`/logs?file=${encodeURIComponent(currentFile)}&mode=head`)
                    } else {
                      router.push("/logs?mode=head")
                    }
                  }}
                  className={`px-2 sm:px-3 py-1 rounded text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                    mode === "head" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Head
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const currentFile = searchParams.get("file")
                    if (currentFile) {
                      router.push(`/logs?file=${encodeURIComponent(currentFile)}&mode=tail`)
                    } else {
                      router.push("/logs?mode=tail")
                    }
                  }}
                  className={`px-2 sm:px-3 py-1 rounded text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                    mode === "tail" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Tail
                </button>
              </div>
              {/* Dark Mode Toggle - moved to last item */}
              <button
                type="button"
                onClick={() => setDarkMode(!darkMode)}
                className="p-2 rounded-md text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ml-2"
                title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              >
                {darkMode ? (
                  // Sun icon for light mode
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                    />
                  </svg>
                ) : (
                  // Moon icon for dark mode
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content Area - Fills remaining space */}
      <div className="flex-1 overflow-hidden">
        <div ref={containerRef} className="max-w-7xl mx-auto px-4 py-6 h-full overflow-y-auto" onScroll={handleScroll}>
          {isInitialLoading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <div className="text-gray-500 text-sm mt-4">Loading logs...</div>
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-400 dark:text-gray-500 text-lg">📝 No logs yet</div>
              <div className="text-gray-500 dark:text-gray-400 text-sm mt-2">
                Logs will appear here as your development server runs
              </div>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-400 dark:text-gray-500 text-lg">🔍 No logs match current filters</div>
              <div className="text-gray-500 dark:text-gray-400 text-sm mt-2">
                Try adjusting your filter settings to see more logs
              </div>
            </div>
          ) : (
            <div className="space-y-1 pb-4">
              {filteredLogs.map((entry, index) => (
                <LogEntryComponent key={`${entry.timestamp}-${index}`} entry={entry} />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>

      {/* Footer - Fixed */}
      <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex-none">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {lastFetched && (
              <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">
                Last updated {lastFetched.toLocaleTimeString()}
              </span>
            )}
            {currentLogFile && (
              <a
                href={`file://${currentLogFile}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                Raw Log ↗
              </a>
            )}
          </div>

          {/* Live indicator or scroll to bottom button - positioned on the right */}
          <div className="relative">
            {/* Live indicator when at bottom */}
            <div
              className={`flex items-center gap-1 text-green-600 ${
                mode === "tail" && isAtBottom ? "visible" : "invisible"
              }`}
            >
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-xs">Live</span>
            </div>

            {/* Scroll to bottom button when not at bottom */}
            <button
              type="button"
              onClick={() => {
                userScrolledManually.current = false // Clear manual scroll flag

                // Flush any buffered logs when explicitly returning to live mode
                if (logBuffer.length > 0) {
                  setLogs((prevLogs) => [...prevLogs, ...logBuffer])
                  setLogBuffer([])
                  setLastFetched(new Date()) // Update "Last updated" when showing buffered logs
                }

                bottomRef.current?.scrollIntoView({ behavior: "smooth" })
              }}
              className={`absolute top-0 right-0 flex items-center gap-1 px-2 py-0.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 whitespace-nowrap ${
                mode === "tail" && !isAtBottom ? "visible" : "invisible"
              }`}
            >
              ↓ Live
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
