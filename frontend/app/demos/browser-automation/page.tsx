import Link from "next/link";

export default function BrowserAutomationDemo() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-black to-gray-900">
      <div className="container mx-auto px-4 py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 mb-8 transition-colors"
        >
          ← Back to Home
        </Link>

        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold text-white mb-4">Browser Automation</h1>
          <p className="text-gray-400 mb-8">
            Execute browser actions, capture screenshots, and replay user interactions via dev3000
            MCP tools
          </p>

          <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-8 backdrop-blur-sm mb-8">
            <h2 className="text-2xl font-bold text-white mb-6">
              Chrome DevTools Protocol Integration
            </h2>

            <div className="space-y-4 text-gray-300">
              <p>
                dev3000 connects to your Chrome browser via Chrome DevTools Protocol (CDP), enabling
                powerful automation and monitoring capabilities.
              </p>

              <p>
                All browser interactions are automatically captured and stored in a unified timeline
                with server logs for comprehensive debugging.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <ActionCard
              title="execute_browser_action"
              description="Click, navigate, scroll, and type in the browser"
              actions={["click", "navigate", "scroll", "type"]}
            />
            <ActionCard
              title="take_screenshot"
              description="Capture full-page or element-specific screenshots"
              actions={["fullPage", "element", "viewport"]}
            />
            <ActionCard
              title="evaluate_script"
              description="Execute JavaScript in the browser context"
              actions={["DOM manipulation", "data extraction"]}
            />
            <ActionCard
              title="get_console_logs"
              description="Retrieve browser console messages and errors"
              actions={["errors", "warnings", "logs"]}
            />
          </div>

          <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-6 mb-8">
            <h3 className="text-white font-semibold mb-4">Example Usage</h3>
            <pre className="bg-black/50 p-4 rounded-lg overflow-x-auto">
              <code className="text-cyan-400 text-sm">
                {`// Navigate to a page
await execute_browser_action({
  action: "navigate",
  params: { url: "http://localhost:3000" }
});

// Click an element
await execute_browser_action({
  action: "click",
  params: { x: 450, y: 300 }
});

// Take a screenshot
await execute_browser_action({
  action: "screenshot"
});`}
              </code>
            </pre>
          </div>

          <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-3">Automatic Screenshot Capture</h3>
            <p className="text-gray-300 mb-4">dev3000 automatically captures screenshots when:</p>
            <ul className="space-y-2 text-gray-300">
              <li className="flex gap-2">
                <span className="text-purple-400">•</span>
                <span>Page navigation occurs</span>
              </li>
              <li className="flex gap-2">
                <span className="text-purple-400">•</span>
                <span>Console errors are detected</span>
              </li>
              <li className="flex gap-2">
                <span className="text-purple-400">•</span>
                <span>Network timeouts happen</span>
              </li>
              <li className="flex gap-2">
                <span className="text-purple-400">•</span>
                <span>Page crashes occur</span>
              </li>
            </ul>
            <p className="text-gray-400 text-sm mt-4">
              All screenshots are stored in{" "}
              <code className="text-purple-400 bg-black/30 px-2 py-1 rounded">
                mcp-server/public/screenshots/
              </code>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionCard({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions: string[];
}) {
  return (
    <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-6">
      <h3 className="text-lg font-semibold text-cyan-400 mb-2 font-mono">{title}</h3>
      <p className="text-gray-300 text-sm mb-4">{description}</p>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <span
            key={action}
            className="px-3 py-1 bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 rounded-full text-xs"
          >
            {action}
          </span>
        ))}
      </div>
    </div>
  );
}
