import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';

interface SetupOptions {
  force?: boolean;
}

export async function setupProject(options: SetupOptions = {}) {
  const cwd = process.cwd();
  
  // Check if this is a Next.js project
  const packageJsonPath = join(cwd, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw new Error('No package.json found. Make sure you\'re in a Next.js project directory.');
  }
  
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  
  // Check for Next.js dependency
  const hasNext = packageJson.dependencies?.next || packageJson.devDependencies?.next;
  if (!hasNext) {
    console.warn(chalk.yellow('⚠️  Next.js not found in dependencies. This tool is designed for Next.js projects.'));
  }
  
  // Create app directory structure if it doesn't exist
  const appDir = join(cwd, 'app');
  if (!existsSync(appDir)) {
    throw new Error('app directory not found. This tool requires Next.js 13+ with app directory.');
  }
  
  // Create MCP API routes
  await createMCPRoutes(cwd, options);
  
  // Update package.json with dev:ai script
  await updatePackageJson(packageJsonPath, packageJson, options);
  
  // Create .gitignore entries
  await updateGitignore(cwd);
  
  console.log(chalk.green('🎉 Setup complete! You can now run:'));
  console.log(chalk.blue('  npm run dev:ai'));
  console.log(chalk.gray('or'));
  console.log(chalk.blue('  pnpm dev:ai'));
}

async function createMCPRoutes(cwd: string, options: SetupOptions) {
  const mcpDir = join(cwd, 'app', 'api', 'mcp');
  const routeDir = join(mcpDir, '[transport]');
  const routeFile = join(routeDir, 'route.ts');
  
  // Check if route already exists
  if (existsSync(routeFile) && !options.force) {
    console.log(chalk.yellow('⚠️  MCP route already exists. Use --force to overwrite.'));
    return;
  }
  
  // Create directories
  mkdirSync(routeDir, { recursive: true });
  
  // Create the MCP route handler
  const routeContent = `import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const handler = createMcpHandler(
  "Next.js AI Development Tools",
  "1.0.0",
  (server) => {
    // Tool to read consolidated logs
    server.tool(
      "read_consolidated_logs",
      "Read the consolidated development logs (server + browser)",
      {
        lines: z.number().optional().describe("Number of recent lines to read (default: 50)"),
        filter: z.string().optional().describe("Filter logs by text content"),
      },
      async ({ lines = 50, filter }) => {
        try {
          const logPath = join(process.cwd(), "ai-dev-tools", "consolidated.log");
          
          if (!existsSync(logPath)) {
            return {
              content: [
                {
                  type: "text",
                  text: "No consolidated log file found. Make sure the dev environment is running with 'npm run dev:ai'."
                }
              ]
            };
          }
          
          const logContent = readFileSync(logPath, "utf-8");
          let logLines = logContent.split("\\n").filter(line => line.trim());
          
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
                  ? recentLines.join("\\n")
                  : "No matching log entries found."
              }
            ]
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text", 
                text: \`Error reading logs: \${error instanceof Error ? error.message : String(error)}\`
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
      },
      async ({ pattern, context = 2 }) => {
        try {
          const logPath = join(process.cwd(), "ai-dev-tools", "consolidated.log");
          
          if (!existsSync(logPath)) {
            return {
              content: [
                {
                  type: "text",
                  text: "No consolidated log file found."
                }
              ]
            };
          }
          
          const logContent = readFileSync(logPath, "utf-8");
          const logLines = logContent.split("\\n");
          
          const regex = new RegExp(pattern, "gi");
          const matches: string[] = [];
          
          logLines.forEach((line, index) => {
            if (regex.test(line)) {
              const start = Math.max(0, index - context);
              const end = Math.min(logLines.length, index + context + 1);
              const contextLines = logLines.slice(start, end);
              
              matches.push(\`Match at line \${index + 1}:\\n\${contextLines.join("\\n")}\\n---\`);
            }
          });
          
          return {
            content: [
              {
                type: "text",
                text: matches.length > 0 
                  ? matches.join("\\n\\n")
                  : "No matches found for the given pattern."
              }
            ]
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: \`Error searching logs: \${error instanceof Error ? error.message : String(error)}\`
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
      },
      async ({ hours = 1 }) => {
        try {
          const logPath = join(process.cwd(), "ai-dev-tools", "consolidated.log");
          
          if (!existsSync(logPath)) {
            return {
              content: [
                {
                  type: "text",
                  text: "No consolidated log file found."
                }
              ]
            };
          }
          
          const logContent = readFileSync(logPath, "utf-8");
          const logLines = logContent.split("\\n");
          
          const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
          const errorLines = logLines.filter(line => {
            if (!line.includes("[BROWSER]")) return false;
            if (!(line.includes("ERROR") || line.includes("CONSOLE ERROR") || line.includes("PAGE ERROR"))) return false;
            
            // Extract timestamp
            const timestampMatch = line.match(/\\[(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z)\\]/);
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
                  ? errorLines.join("\\n")
                  : "No browser errors found in the specified time period."
              }
            ]
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: \`Error getting browser errors: \${error instanceof Error ? error.message : String(error)}\`
              }
            ]
          };
        }
      }
    );
  }
);

export { handler as GET, handler as POST };`;

  writeFileSync(routeFile, routeContent);
  console.log(chalk.green(`✅ Created MCP route: ${routeFile}`));
}

async function updatePackageJson(packageJsonPath: string, packageJson: any, options: SetupOptions) {
  // Add dev:ai script
  if (!packageJson.scripts) {
    packageJson.scripts = {};
  }
  
  if (packageJson.scripts['dev:ai'] && !options.force) {
    console.log(chalk.yellow('⚠️  dev:ai script already exists. Use --force to overwrite.'));
    return;
  }
  
  packageJson.scripts['dev:ai'] = 'nextjs-ai-dev start';
  
  // Add mcp-handler and zod if not present
  if (!packageJson.dependencies) {
    packageJson.dependencies = {};
  }
  
  if (!packageJson.dependencies['mcp-handler']) {
    packageJson.dependencies['mcp-handler'] = '^1.0.2';
  }
  
  if (!packageJson.dependencies['zod']) {
    packageJson.dependencies['zod'] = '^3.22.4';
  }
  
  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  console.log(chalk.green('✅ Updated package.json with dev:ai script and dependencies'));
}

async function updateGitignore(cwd: string) {
  const gitignorePath = join(cwd, '.gitignore');
  let gitignoreContent = '';
  
  if (existsSync(gitignorePath)) {
    gitignoreContent = readFileSync(gitignorePath, 'utf-8');
  }
  
  const entriesToAdd = [
    'ai-dev-tools/',
    'ai-dev-tools/chrome-profile/',
    'ai-dev-tools/consolidated.log',
  ];
  
  let needsUpdate = false;
  for (const entry of entriesToAdd) {
    if (!gitignoreContent.includes(entry)) {
      gitignoreContent += `\\n${entry}`;
      needsUpdate = true;
    }
  }
  
  if (needsUpdate) {
    writeFileSync(gitignorePath, gitignoreContent);
    console.log(chalk.green('✅ Updated .gitignore'));
  }
}