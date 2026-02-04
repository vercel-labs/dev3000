import { describe, expect, it } from "vitest"
import {
  extractProjectNameFromLogFilename,
  extractTimestampFromLogFilename,
  logFilenameMatchesProject
} from "./log-filename"

describe("extractProjectNameFromLogFilename", () => {
  it("should extract project name from standard log filename", () => {
    expect(extractProjectNameFromLogFilename("tailwindui-studio-2025-10-27T17-57-15-014Z.log")).toBe(
      "tailwindui-studio"
    )
  })

  it("should extract project name with multiple hyphens", () => {
    expect(extractProjectNameFromLogFilename("my-awesome-project-2025-10-27T17-57-15-014Z.log")).toBe(
      "my-awesome-project"
    )
  })

  it("should extract project name with numbers", () => {
    expect(extractProjectNameFromLogFilename("project123-2025-10-27T17-57-15-014Z.log")).toBe("project123")
  })

  it("should handle project name with hash suffix", () => {
    expect(extractProjectNameFromLogFilename("my-app-a3b5c7-2025-10-27T17-57-15-014Z.log")).toBe("my-app-a3b5c7")
  })

  it("should return null for invalid filename format", () => {
    expect(extractProjectNameFromLogFilename("invalid-log-file.log")).toBeNull()
  })

  it("should return null for filename without .log extension", () => {
    expect(extractProjectNameFromLogFilename("tailwindui-studio-2025-10-27T17-57-15-014Z.txt")).toBeNull()
  })

  it("should return null for empty string", () => {
    expect(extractProjectNameFromLogFilename("")).toBeNull()
  })

  it("should extract project name from current log file (-d3k.log pattern)", () => {
    expect(extractProjectNameFromLogFilename("tailwindui-studio-d3k.log")).toBe("tailwindui-studio")
  })

  it("should extract project name from nested project name with -d3k.log pattern", () => {
    expect(extractProjectNameFromLogFilename("dev3000-tools-service-d3k.log")).toBe("dev3000-tools-service")
  })
})

describe("logFilenameMatchesProject", () => {
  it("should match exact project name", () => {
    expect(logFilenameMatchesProject("tailwindui-studio-2025-10-27T17-57-15-014Z.log", "tailwindui-studio")).toBe(true)
  })

  it("should match partial project name", () => {
    expect(logFilenameMatchesProject("tailwindui-studio-2025-10-27T17-57-15-014Z.log", "studio")).toBe(true)
  })

  it("should match project name prefix", () => {
    expect(logFilenameMatchesProject("tailwindui-studio-2025-10-27T17-57-15-014Z.log", "tailwindui")).toBe(true)
  })

  it("should not match different project", () => {
    expect(logFilenameMatchesProject("tailwindui-studio-2025-10-27T17-57-15-014Z.log", "my-app")).toBe(false)
  })

  it("should return false for invalid filename", () => {
    expect(logFilenameMatchesProject("invalid-file.log", "project")).toBe(false)
  })

  it("should match current log file (-d3k.log pattern)", () => {
    expect(logFilenameMatchesProject("tailwindui-studio-d3k.log", "tailwindui-studio")).toBe(true)
  })

  it("should match partial project name in current log file", () => {
    expect(logFilenameMatchesProject("dev3000-tools-service-d3k.log", "tools-service")).toBe(true)
  })
})

describe("extractTimestampFromLogFilename", () => {
  it("should extract and convert timestamp to ISO format", () => {
    expect(extractTimestampFromLogFilename("tailwindui-studio-2025-10-27T17-57-15-014Z.log")).toBe(
      "2025-10-27T17:57:15.014Z"
    )
  })

  it("should handle different timestamps", () => {
    expect(extractTimestampFromLogFilename("my-app-2025-01-15T08-30-45-123Z.log")).toBe("2025-01-15T08:30:45.123Z")
  })

  it("should return null for invalid filename", () => {
    expect(extractTimestampFromLogFilename("invalid-file.log")).toBeNull()
  })

  it("should return null for d3k.log files", () => {
    expect(extractTimestampFromLogFilename("tailwindui-studio-d3k.log")).toBeNull()
  })
})

describe("Real-world log filename scenarios", () => {
  const realFilenames = [
    { filename: "tailwindui-studio-2025-10-27T17-57-15-014Z.log", project: "tailwindui-studio" },
    { filename: "ai-chatbot-2025-10-20T15-44-20-139Z.log", project: "ai-chatbot" },
    { filename: "commoner-2025-10-20T19-04-27-621Z.log", project: "commoner" },
    { filename: "svelte-dev-2025-10-23T04-50-04-279Z.log", project: "svelte-dev" },
    { filename: "t3app-demo-2025-10-23T15-43-02-910Z.log", project: "t3app-demo" }
  ]

  it("should correctly extract project names from all real-world examples", () => {
    for (const { filename, project } of realFilenames) {
      expect(extractProjectNameFromLogFilename(filename)).toBe(project)
    }
  })

  it("should correctly match projects from all real-world examples", () => {
    for (const { filename, project } of realFilenames) {
      expect(logFilenameMatchesProject(filename, project)).toBe(true)
    }
  })

  it("should support partial matching for project queries", () => {
    // Simulates user querying ?project=studio
    expect(logFilenameMatchesProject("tailwindui-studio-2025-10-27T17-57-15-014Z.log", "studio")).toBe(true)

    // Simulates user querying ?project=chatbot
    expect(logFilenameMatchesProject("ai-chatbot-2025-10-20T15-44-20-139Z.log", "chatbot")).toBe(true)
  })
})
