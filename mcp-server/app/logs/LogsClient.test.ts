import { describe, expect, it } from "vitest"
import { parseLogEntries } from "./utils"

describe("parseLogEntries", () => {
  it("should parse single-line log entries correctly", () => {
    const logContent = `[2025-09-03T03:57:39.357Z] [SERVER] myapp:dev: Cache hits: 5, misses: 2
[2025-09-03T03:57:40.123Z] [BROWSER] [CONSOLE LOG] Component rendered successfully`

    const entries = parseLogEntries(logContent)

    expect(entries).toHaveLength(2)

    expect(entries[0]).toEqual({
      timestamp: "2025-09-03T03:57:39.357Z",
      source: "SERVER",
      message: "myapp:dev: Cache hits: 5, misses: 2",
      original: "[2025-09-03T03:57:39.357Z] [SERVER] myapp:dev: Cache hits: 5, misses: 2"
    })

    expect(entries[1]).toEqual({
      timestamp: "2025-09-03T03:57:40.123Z",
      source: "BROWSER",
      message: "[CONSOLE LOG] Component rendered successfully",
      original: "[2025-09-03T03:57:40.123Z] [BROWSER] [CONSOLE LOG] Component rendered successfully"
    })
  })

  it("should group multi-line log entries by timestamp", () => {
    const logContent = `[2025-09-03T03:57:39.614Z] [SERVER] myapp:dev: api_request[warn] Server error: {
myapp:dev:   request: '/api/v1/users/search',
myapp:dev:   reason: Error [AuthError]: Missing authentication token
myapp:dev:       at validateAuth (../../packages/auth/src/middleware.ts:45:28)
myapp:dev:     43 |         const token = req.headers.authorization;
myapp:dev:     44 |         if (!token) {
myapp:dev:   > 45 |           throw new Error('Missing authentication token');
myapp:dev:         |                 ^
myapp:dev:     46 |         }
myapp:dev:     47 |         return validateToken(token);
myapp:dev:     48 |       }
myapp:dev:     code: 'auth_required',
myapp:dev:     status: 401,
myapp:dev:     attributes: {
myapp:dev:       'http.method': 'GET',
myapp:dev:       'http.url': 'http://localhost:3000/api/v1/users/search',
myapp:dev:       'http.status_code': 401,
myapp:dev:       'request.id': 'req_abc123def456'
myapp:dev:     },
myapp:dev:     missingAuth: true
myapp:dev:   }
myapp:dev: }
[2025-09-03T03:57:40.778Z] [SERVER] myapp:dev: Cache[info] Prefetch unused: [ '"/api/v2/users?page=1"' ]`

    const entries = parseLogEntries(logContent)

    expect(entries).toHaveLength(2)

    // First entry should contain the entire multi-line error
    expect(entries[0].timestamp).toBe("2025-09-03T03:57:39.614Z")
    expect(entries[0].source).toBe("SERVER")
    expect(entries[0].message).toContain("api_request[warn] Server error: {")
    expect(entries[0].message).toContain("Missing authentication token")
    expect(entries[0].message).toContain("missingAuth: true")
    expect(entries[0].message).toContain("}")

    // Second entry should be the single-line cache message
    expect(entries[1].timestamp).toBe("2025-09-03T03:57:40.778Z")
    expect(entries[1].source).toBe("SERVER")
    expect(entries[1].message).toBe("myapp:dev: Cache[info] Prefetch unused: [ '\"/api/v2/users?page=1\"' ]")
  })

  it("should handle screenshot entries correctly", () => {
    const logContent = `[2025-09-03T02:14:27.444Z] [BROWSER] [SCREENSHOT] http://localhost:3684/screenshots/2025-09-03T02-14-27-329Z-initial-load.png
[2025-09-03T02:14:27.444Z] [BROWSER] 📄 New page: http://localhost:3000/`

    const entries = parseLogEntries(logContent)

    expect(entries).toHaveLength(2)

    expect(entries[0].screenshot).toBe("http://localhost:3684/screenshots/2025-09-03T02-14-27-329Z-initial-load.png")
    expect(entries[0].message).toBe(
      "[SCREENSHOT] http://localhost:3684/screenshots/2025-09-03T02-14-27-329Z-initial-load.png"
    )

    expect(entries[1].screenshot).toBeUndefined()
    expect(entries[1].message).toBe("📄 New page: http://localhost:3000/")
  })

  it("should handle complex stack traces and nested objects", () => {
    const logContent = `[2025-09-03T03:57:39.098Z] [SERVER] ❌ Database connection failed: DatabaseError: Connection timeout
myapp:dev:     at ConnectionPool.connect (/app/src/database/pool.ts:142:15)
myapp:dev:     at DatabaseService.initialize (/app/src/services/database.ts:87:31)
myapp:dev:     at async Server.start (/app/src/server.ts:56:8)
myapp:dev:   > 142 |       throw new DatabaseError('Connection timeout');
myapp:dev:         |             ^
myapp:dev:     143 |     }
myapp:dev:     144 |     return connection;
myapp:dev:     145 |   }
[2025-09-03T03:57:39.098Z] [SERVER] ❌ Error details: {
myapp:dev:   message: 'connection.query is not a function',
myapp:dev:   stack: 'TypeError: connection.query is not a function\\n' +
myapp:dev:     '    at Database.execute (/app/src/database/client.ts:89:27)\\n' +
myapp:dev:     '    at UserService.findById (/app/src/services/user.ts:45:19)\\n' +
myapp:dev:     '    at async Handler.getUser (/app/src/handlers/user.ts:23:18)',
myapp:dev:   config: {
myapp:dev:     host: 'localhost',
myapp:dev:     port: 5432,
myapp:dev:     database: 'myapp_dev',
myapp:dev:     retries: 3
myapp:dev:   },
myapp:dev:   connectionId: 'conn_xyz789abc'
myapp:dev: }
[2025-09-03T03:57:40.200Z] [BROWSER] [CONSOLE ERROR] Uncaught TypeError: Cannot read properties of null`

    const entries = parseLogEntries(logContent)

    expect(entries).toHaveLength(3)

    // First entry - connection error with stack trace
    expect(entries[0].timestamp).toBe("2025-09-03T03:57:39.098Z")
    expect(entries[0].source).toBe("SERVER")
    expect(entries[0].message).toContain("❌ Database connection failed")
    expect(entries[0].message).toContain("ConnectionPool.connect")
    expect(entries[0].message).toContain("Connection timeout")

    // Second entry - error details object
    expect(entries[1].timestamp).toBe("2025-09-03T03:57:39.098Z")
    expect(entries[1].source).toBe("SERVER")
    expect(entries[1].message).toContain("❌ Error details: {")
    expect(entries[1].message).toContain("connection.query is not a function")
    expect(entries[1].message).toContain("connectionId: 'conn_xyz789abc'")

    // Third entry - browser error
    expect(entries[2].timestamp).toBe("2025-09-03T03:57:40.200Z")
    expect(entries[2].source).toBe("BROWSER")
    expect(entries[2].message).toBe("[CONSOLE ERROR] Uncaught TypeError: Cannot read properties of null")
  })

  it("should handle empty and malformed log content", () => {
    expect(parseLogEntries("")).toHaveLength(0)
    expect(parseLogEntries("   \n  \n  ")).toHaveLength(0)
    expect(parseLogEntries("Invalid log line without timestamp")).toHaveLength(0)
  })

  it("should preserve original content for debugging", () => {
    const logContent = `[2025-09-03T03:57:39.357Z] [SERVER] API response: {
myapp:dev:   userId: 'user_123',
myapp:dev:   status: 'active'
myapp:dev: }`

    const entries = parseLogEntries(logContent)

    expect(entries).toHaveLength(1)
    expect(entries[0].original).toBe(logContent)
    expect(entries[0].message).toContain("API response: {")
    expect(entries[0].message).toContain("userId: 'user_123'")
  })

  it("should handle mixed single-line and multi-line entries", () => {
    const logContent = `[2025-09-03T03:57:38.500Z] [SERVER] ✓ Server started on port 3000
[2025-09-03T03:57:39.614Z] [SERVER] myapp:dev: validation[error] Request failed: {
myapp:dev:   endpoint: '/api/v1/validate',
myapp:dev:   errors: [
myapp:dev:     { field: 'email', message: 'Invalid format' },
myapp:dev:     { field: 'password', message: 'Too short' }
myapp:dev:   ],
myapp:dev:   requestId: 'req_validation_456'
myapp:dev: }
[2025-09-03T03:57:40.100Z] [BROWSER] [NAVIGATION] http://localhost:3000/dashboard
[2025-09-03T03:57:40.300Z] [SERVER] Dashboard page rendered in 89ms`

    const entries = parseLogEntries(logContent)

    expect(entries).toHaveLength(4)

    // Single-line entries
    expect(entries[0].message).toBe("✓ Server started on port 3000")
    expect(entries[2].message).toBe("[NAVIGATION] http://localhost:3000/dashboard")
    expect(entries[3].message).toBe("Dashboard page rendered in 89ms")

    // Multi-line entry
    expect(entries[1].message).toContain("validation[error] Request failed: {")
    expect(entries[1].message).toContain("Invalid format")
    expect(entries[1].message).toContain("requestId: 'req_validation_456'")
  })

  it("should handle console log entries with CSS formatting directives", () => {
    const logContent = `[2025-09-09T21:24:27.264Z] [BROWSER] [CONSOLE LOG] %c[Vercel Web Analytics]%c Debug mode is enabled by default in development. No requests will be sent to the server. color: rgb(120, 120, 120) color: inherit
[2025-09-09T21:24:27.264Z] [BROWSER] [CONSOLE LOG] %c[Vercel Speed Insights]%c [vitals] color: rgb(120, 120, 120) color: inherit {"type":"object","description":"Object","overflow":false}`

    const entries = parseLogEntries(logContent)

    expect(entries).toHaveLength(2)

    // First entry should have CSS formatting cleaned up
    expect(entries[0].timestamp).toBe("2025-09-09T21:24:27.264Z")
    expect(entries[0].source).toBe("BROWSER")
    expect(entries[0].message).toBe(
      "[CONSOLE LOG] [Vercel Web Analytics] Debug mode is enabled by default in development. No requests will be sent to the server."
    )

    // Second entry should have CSS formatting cleaned up and preserve JSON
    expect(entries[1].timestamp).toBe("2025-09-09T21:24:27.264Z")
    expect(entries[1].source).toBe("BROWSER")
    expect(entries[1].message).toBe(
      '[CONSOLE LOG] [Vercel Speed Insights] [vitals] {"type":"object","description":"Object","overflow":false}'
    )
  })

  it("should extract screenshot filenames correctly excluding browser type tags", () => {
    const logContent = `[2025-09-10T21:24:42.976Z] [BROWSER] [SCREENSHOT] 2025-09-10T21-24-42-976Z-scroll-settled.png [PLAYWRIGHT]
[2025-09-10T21:25:15.123Z] [TAB-1.2] [BROWSER] [SCREENSHOT] 2025-09-10T21-25-15-123Z-click.png [CHROME_EXTENSION]
[2025-09-10T21:25:30.456Z] [BROWSER] [SCREENSHOT] 2025-09-10T21-25-30-456Z-error.png [PLAYWRIGHT] with additional context
[2025-09-10T21:26:00.789Z] [BROWSER] [SCREENSHOT] 2025-09-10T21-26-00-789Z-navigation.png`

    const entries = parseLogEntries(logContent)

    expect(entries).toHaveLength(4)

    // Test Playwright screenshot - should extract filename without [PLAYWRIGHT] tag
    expect(entries[0].screenshot).toBe("2025-09-10T21-24-42-976Z-scroll-settled.png")
    expect(entries[0].screenshot).not.toContain("[PLAYWRIGHT]")

    // Test Chrome Extension screenshot - should extract filename without [CHROME_EXTENSION] tag
    expect(entries[1].screenshot).toBe("2025-09-10T21-25-15-123Z-click.png")
    expect(entries[1].screenshot).not.toContain("[CHROME_EXTENSION]")
    expect(entries[1].tabIdentifier).toBe("TAB-1.2")

    // Test screenshot with additional context after browser tag
    expect(entries[2].screenshot).toBe("2025-09-10T21-25-30-456Z-error.png")
    expect(entries[2].screenshot).not.toContain("[PLAYWRIGHT]")
    expect(entries[2].screenshot).not.toContain("with")

    // Test screenshot without browser type tag
    expect(entries[3].screenshot).toBe("2025-09-10T21-26-00-789Z-navigation.png")
  })

  it("should only remove CHROME_EXTENSION markers from displayed message", () => {
    // Note: [PLAYWRIGHT] tags are no longer generated in the source logs
    const playwrightLog = `[2025-09-10T21:24:42.976Z] [BROWSER] [CONSOLE LOG] App initialized`
    const extensionLog = `[2025-09-10T21:24:42.976Z] [TAB-123.456] [BROWSER] [CONSOLE ERROR] Script error [CHROME_EXTENSION]`

    const entries1 = parseLogEntries(playwrightLog)
    const entries2 = parseLogEntries(extensionLog)

    expect(entries1).toHaveLength(1)
    expect(entries1[0].message).toBe("[CONSOLE LOG] App initialized")
    expect(entries1[0].original).not.toContain("[PLAYWRIGHT]")

    expect(entries2).toHaveLength(1)
    expect(entries2[0].message).toBe("[CONSOLE ERROR] Script error") // CHROME_EXTENSION removed
    expect(entries2[0].message).not.toContain("[CHROME_EXTENSION]")
    expect(entries2[0].original).toContain("[CHROME_EXTENSION]")
    expect(entries2[0].tabIdentifier).toBe("TAB-123.456")
  })

  it("should generate valid image URLs from screenshot filenames", () => {
    const logContent = `[2025-09-10T21:24:42.976Z] [BROWSER] [SCREENSHOT] 2025-09-10T21-24-42-976Z-scroll-settled.png [PLAYWRIGHT]`

    const entries = parseLogEntries(logContent)
    expect(entries).toHaveLength(1)

    const screenshot = entries[0].screenshot
    expect(screenshot).toBe("2025-09-10T21-24-42-976Z-scroll-settled.png")

    // Verify the screenshot filename would create a valid URL
    const imageUrl = `/screenshots/${screenshot}`
    expect(imageUrl).toBe("/screenshots/2025-09-10T21-24-42-976Z-scroll-settled.png")

    // Verify no invalid characters that would break URLs
    expect(screenshot).not.toMatch(/[\s[\]]/) // No spaces, brackets
    expect(screenshot).toMatch(/^[\w.-]+$/) // Only valid filename characters
  })

  it("should handle various server framework log patterns", () => {
    const frameworkLogs = [
      `[2025-09-10T21:24:42.976Z] [SERVER] Ready on http://localhost:3000`,
      `[2025-09-10T21:24:42.976Z] [SERVER] Nuxt server ready on http://localhost:3000`,
      `[2025-09-10T21:24:42.976Z] [SERVER] vue-cli-service serve starting...`,
      `[2025-09-10T21:24:42.976Z] [SERVER] Local: http://localhost:3000/ - vite dev server`,
      `[2025-09-10T21:24:42.976Z] [SERVER] Rails server starting on port 3000`,
      `[2025-09-10T21:24:42.976Z] [SERVER] Laravel development server started: http://127.0.0.1:8000`,
      `[2025-09-10T21:24:42.976Z] [SERVER] Express server listening on port 3000`,
      `[2025-09-10T21:24:42.976Z] [SERVER] Starting development server at http://127.0.0.1:8000/ - Django`,
      `[2025-09-10T21:24:42.976Z] [SERVER] Flask running on http://127.0.0.1:5000/`,
      `[2025-09-10T21:24:42.976Z] [SERVER] SvelteKit dev server ready`,
      `[2025-09-10T21:24:42.976Z] [SERVER] Remix dev server running`,
      `[2025-09-10T21:24:42.976Z] [SERVER] Astro dev server started`,
      `[2025-09-10T21:24:42.976Z] [SERVER] Tomcat started on port 8080 - Spring Boot application`
    ]

    const entries = parseLogEntries(frameworkLogs.join("\n"))

    expect(entries).toHaveLength(13)
    expect(entries[0].source).toBe("SERVER")
    expect(entries[0].message).toBe("Ready on http://localhost:3000")

    // Verify each entry is properly parsed as SERVER source
    entries.forEach((entry) => {
      expect(entry.source).toBe("SERVER")
      expect(entry.timestamp).toBe("2025-09-10T21:24:42.976Z")
    })
  })

  describe("Server Framework Detection", () => {
    // Helper function to test framework detection patterns
    const testFrameworkDetection = (frameworkName: string, testCases: string[]) => {
      testCases.forEach((logMessage, index) => {
        it(`should detect ${frameworkName} from pattern ${index + 1}: "${logMessage}"`, () => {
          const logContent = `[2025-09-10T21:24:42.976Z] [SERVER] ${logMessage}`
          const entries = parseLogEntries(logContent)

          expect(entries).toHaveLength(1)
          expect(entries[0].source).toBe("SERVER")
          expect(entries[0].message).toBe(logMessage)
          // Note: Actual framework pill detection happens in the UI component,
          // this test ensures the log is parsed correctly for detection
        })
      })
    }

    // Test cases for each framework - add new frameworks here!
    testFrameworkDetection("Next.js", [
      "Ready on http://localhost:3000",
      "ready in 2.3s",
      "Next.js application starting",
      "Compiled client and server successfully"
    ])

    testFrameworkDetection("Nuxt", [
      "Nuxt server listening on http://localhost:3000",
      "Nitro server started on http://localhost:3000",
      "Universal mode enabled",
      "SPA mode enabled"
    ])

    testFrameworkDetection("Vue", [
      "vue-cli-service serve --port 3000",
      "Vue development server running on local: http://localhost:3000",
      "@vue/cli-service starting"
    ])

    testFrameworkDetection("Vite", [
      "Local: http://localhost:3000/ - vite dev server",
      "Dev server running at http://localhost:3000",
      "Vite v4.0.0 dev server running"
    ])

    testFrameworkDetection("Rails", [
      "Rails server starting on port 3000",
      "Puma starting in development mode",
      "Use Ctrl-C to stop server",
      "Listening on tcp://localhost:3000"
    ])

    testFrameworkDetection("Laravel", [
      "Laravel development server started: http://127.0.0.1:8000",
      "Artisan serve command starting",
      "Laravel app running on http://127.0.0.1:8000"
    ])

    testFrameworkDetection("Express", [
      "Express server listening on port 3000",
      "Server listening on http://localhost:3000",
      "App listening on port 3000",
      "Node server started on port 3000"
    ])

    testFrameworkDetection("Django", [
      "Starting development server at http://127.0.0.1:8000/",
      "Django development server running",
      "python manage.py runserver"
    ])

    testFrameworkDetection("Flask", [
      "Flask running on http://127.0.0.1:5000/",
      "Running on http://127.0.0.1:5000/",
      "Debug mode: on"
    ])

    testFrameworkDetection("Svelte", [
      "SvelteKit dev server started",
      "Svelte development mode",
      "@sveltejs/kit starting"
    ])

    testFrameworkDetection("Remix", ["Remix dev server started", "@remix-run/dev server running"])

    testFrameworkDetection("Astro", ["Astro dev server started", "@astrojs/dev starting"])

    testFrameworkDetection("Spring Boot", [
      "Tomcat started on port 8080",
      "Spring Boot application started in 3.2 seconds",
      "Started Application in 2.1 seconds"
    ])

    // Test that non-framework logs don't get detected
    it("should not detect frameworks from generic server logs", () => {
      const genericLogs = [
        "[2025-09-10T21:24:42.976Z] [SERVER] Server started successfully",
        "[2025-09-10T21:24:42.976Z] [SERVER] Processing request...",
        "[2025-09-10T21:24:42.976Z] [SERVER] Database connection established",
        "[2025-09-10T21:24:42.976Z] [SERVER] Cache cleared"
      ]

      const entries = parseLogEntries(genericLogs.join("\n"))

      expect(entries).toHaveLength(4)
      entries.forEach((entry) => {
        expect(entry.source).toBe("SERVER")
        // These should be parsed correctly but not trigger framework detection
        expect(entry.message).not.toMatch(/ready on http:\/\//)
        expect(entry.message).not.toMatch(/listening on/)
      })
    })
  })
})
