import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const handler = createMcpHandler((server) => {
    // Tool to read consolidated logs
    server.tool(
      "read_consolidated_logs",
      "Read the consolidated development logs (server + browser)",
      {
        lines: z.number().optional().describe("Number of recent lines to read (default: 50)"),
        filter: z.string().optional().describe("Filter logs by text content"),
        logPath: z.string().optional().describe("Path to log file (default: ./ai-dev-tools/consolidated.log)"),
      },
      async ({ lines = 50, filter, logPath = "./ai-dev-tools/consolidated.log" }) => {
        try {
          if (!existsSync(logPath)) {
            return {
              content: [
                {
                  type: "text",
                  text: `No log file found at ${logPath}. Make sure the dev environment is running.`
                }
              ]
            };
          }
          
          const logContent = readFileSync(logPath, "utf-8");
          let logLines = logContent.split("\n").filter(line => line.trim());
          
          // Apply filter if provided
          if (filter) {
            logLines = logLines.filter(line => 
              line.toLowerCase().includes(filter.toLowerCase())
            );
          }
          
          // Get recent lines
          const recentLines = logLines.slice(-lines);
          
          return {
            content: [
              {
                type: "text",
                text: recentLines.length > 0 
                  ? recentLines.join("\n")
                  : "No matching log entries found."
              }
            ]
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text", 
                text: `Error reading logs: ${error instanceof Error ? error.message : String(error)}`
              }
            ]
          };
        }
      }
    );

    // Tool to search logs
    server.tool(
      "search_logs",
      "Search through consolidated logs with regex patterns",
      {
        pattern: z.string().describe("Regex pattern to search for"),
        context: z.number().optional().describe("Number of lines of context around matches (default: 2)"),
        logPath: z.string().optional().describe("Path to log file (default: ./ai-dev-tools/consolidated.log)"),
      },
      async ({ pattern, context = 2, logPath = "./ai-dev-tools/consolidated.log" }) => {
        try {
          if (!existsSync(logPath)) {
            return {
              content: [
                {
                  type: "text",
                  text: `No log file found at ${logPath}.`
                }
              ]
            };
          }
          
          const logContent = readFileSync(logPath, "utf-8");
          const logLines = logContent.split("\n");
          
          const regex = new RegExp(pattern, "gi");
          const matches: string[] = [];
          
          logLines.forEach((line, index) => {
            if (regex.test(line)) {
              const start = Math.max(0, index - context);
              const end = Math.min(logLines.length, index + context + 1);
              const contextLines = logLines.slice(start, end);
              
              matches.push(`Match at line ${index + 1}:\n${contextLines.join("\n")}\n---`);
            }
          });
          
          return {
            content: [
              {
                type: "text",
                text: matches.length > 0 
                  ? matches.join("\n\n")
                  : "No matches found for the given pattern."
              }
            ]
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error searching logs: ${error instanceof Error ? error.message : String(error)}`
              }
            ]
          };
        }
      }
    );

    // Tool to get browser errors
    server.tool(
      "get_browser_errors",
      "Get recent browser errors and page errors from logs",
      {
        hours: z.number().optional().describe("Hours to look back (default: 1)"),
        logPath: z.string().optional().describe("Path to log file (default: ./ai-dev-tools/consolidated.log)"),
      },
      async ({ hours = 1, logPath = "./ai-dev-tools/consolidated.log" }) => {
        try {
          if (!existsSync(logPath)) {
            return {
              content: [
                {
                  type: "text",
                  text: `No log file found at ${logPath}.`
                }
              ]
            };
          }
          
          const logContent = readFileSync(logPath, "utf-8");
          const logLines = logContent.split("\n");
          
          const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
          const errorLines = logLines.filter(line => {
            if (!line.includes("[BROWSER]")) return false;
            if (!(line.includes("ERROR") || line.includes("CONSOLE ERROR") || line.includes("PAGE ERROR"))) return false;
            
            // Extract timestamp
            const timestampMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/);
            if (timestampMatch) {
              const logTime = new Date(timestampMatch[1]);
              return logTime > cutoffTime;
            }
            return true; // Include if we can't parse timestamp
          });
          
          return {
            content: [
              {
                type: "text",
                text: errorLines.length > 0 
                  ? errorLines.join("\n")
                  : "No browser errors found in the specified time period."
              }
            ]
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error getting browser errors: ${error instanceof Error ? error.message : String(error)}`
              }
            ]
          };
        }
      }
    );
});

export { handler as GET, handler as POST };