import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import { redirect } from "next/navigation"
import { basename, dirname, join } from "path"
import LogsClient from "./LogsClient"
import { parseLogEntries } from "./utils"

interface PageProps {
  searchParams: Promise<{ file?: string; mode?: "head" | "tail" }>
}

async function getLogFiles() {
  try {
    const currentLogPath = process.env.LOG_FILE_PATH || "/var/log/dev3000/dev3000.log"

    if (!existsSync(currentLogPath)) {
      return { files: [], currentFile: "", projectName: "unknown" }
    }

    const logDir = dirname(currentLogPath)
    const currentLogName = basename(currentLogPath)

    // Extract project name from current log filename
    const projectMatch = currentLogName.match(/^dev3000-(.+?)-\d{4}-\d{2}-\d{2}T/)
    const projectName = projectMatch ? projectMatch[1] : "unknown"

    const dirContents = readdirSync(logDir)
    const logFiles = dirContents
      .filter((file) => file.startsWith(`dev3000-${projectName}-`) && file.endsWith(".log"))
      .map((file) => {
        const filePath = join(logDir, file)
        const stats = statSync(filePath)

        const timestampMatch = file.match(/(\d{4}-\d{2}-\d{2}T[\d-]+Z)/)
        const timestamp = timestampMatch ? timestampMatch[1].replace(/-/g, ":") : ""

        return {
          name: file,
          path: filePath,
          timestamp,
          size: stats.size,
          mtime: stats.mtime,
          isCurrent: file === currentLogName
        }
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

    return {
      files: logFiles,
      currentFile: currentLogPath,
      projectName
    }
  } catch (_error) {
    return { files: [], currentFile: "", projectName: "unknown" }
  }
}

async function getLogData(logPath: string, mode: "head" | "tail" = "tail", lines: number = 100) {
  try {
    if (!existsSync(logPath)) {
      return { logs: "", total: 0 }
    }

    const logContent = readFileSync(logPath, "utf-8")
    const allLines = logContent.split("\n").filter((line) => line.trim())

    const selectedLines = mode === "head" ? allLines.slice(0, lines) : allLines.slice(-lines)

    return {
      logs: selectedLines.join("\n"),
      total: allLines.length
    }
  } catch (_error) {
    return { logs: "", total: 0 }
  }
}

export default async function LogsPage({ searchParams }: PageProps) {
  const version = process.env.DEV3000_VERSION || "0.0.0"

  // Await searchParams (Next.js 15 requirement)
  const params = await searchParams

  // Get available log files
  const { files, currentFile } = await getLogFiles()

  // If no file specified and we have files, redirect to latest with tail mode
  if (!params.file && files.length > 0) {
    const latestFile = files[0].name
    redirect(`/logs?file=${encodeURIComponent(latestFile)}&mode=tail`)
  }

  // If no file specified and no files available, render with empty data
  if (!params.file) {
    return (
      <LogsClient
        version={version}
        initialData={{
          logs: [],
          logFiles: [],
          currentLogFile: "",
          mode: "tail"
        }}
      />
    )
  }

  // Find the selected log file
  const selectedFile = files.find((f) => f.name === params.file)
  const logPath = selectedFile?.path || currentFile

  // Always default to 'tail' mode for initial loads
  const _isCurrentFile = selectedFile?.isCurrent !== false
  const defaultMode = "tail" // Always start in tail mode
  const mode = (params.mode as "head" | "tail") || defaultMode

  // Get initial log data server-side
  const logData = await getLogData(logPath, mode)
  const parsedLogs = parseLogEntries(logData.logs)

  return (
    <LogsClient
      version={version}
      initialData={{
        logs: parsedLogs,
        logFiles: files,
        currentLogFile: logPath,
        mode
      }}
    />
  )
}
