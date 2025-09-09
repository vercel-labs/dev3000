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
})
