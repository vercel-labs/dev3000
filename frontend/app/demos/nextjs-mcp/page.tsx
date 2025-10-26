import Link from "next/link";

export default function NextJsMcpDemo() {
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
          <h1 className="text-4xl font-bold text-white mb-4">Next.js Builtin MCP</h1>
          <p className="text-gray-400 mb-8">
            Model Context Protocol built directly into Next.js 16 for seamless AI integration
          </p>

          <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-8 backdrop-blur-sm mb-8">
            <h2 className="text-2xl font-bold text-white mb-6">What is Next.js MCP?</h2>

            <div className="space-y-4 text-gray-300">
              <p>
                Next.js 16 includes builtin Model Context Protocol (MCP) support, allowing AI
                assistants to interact directly with your Next.js application at runtime.
              </p>

              <p>
                The MCP endpoint is available at{" "}
                <code className="text-cyan-400 bg-black/30 px-2 py-1 rounded">/_next/mcp</code> when
                running in development mode.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <FeatureCard
              title="Runtime Diagnostics"
              description="Get real-time information about errors, compilation status, and runtime state"
              icon="📊"
            />
            <FeatureCard
              title="Route Inspection"
              description="Query available routes, dynamic segments, and route handlers"
              icon="🛣️"
            />
            <FeatureCard
              title="Component Tree"
              description="Inspect the component hierarchy and server/client boundaries"
              icon="🌳"
            />
            <FeatureCard
              title="Build Information"
              description="Access build status, cache information, and optimization details"
              icon="🔧"
            />
          </div>

          <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-6 mb-8">
            <h3 className="text-white font-semibold mb-4">Available MCP Tools</h3>
            <div className="space-y-3">
              <CodeBlock title="nextjs_runtime" description="Query runtime state and diagnostics" />
              <CodeBlock title="list_tools" description="Discover all available MCP tools" />
              <CodeBlock title="discover_servers" description="Find running Next.js dev servers" />
            </div>
          </div>

          <div className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/30 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-3">How to Use</h3>
            <ol className="space-y-3 text-gray-300">
              <li className="flex gap-3">
                <span className="text-cyan-400 font-bold">1.</span>
                <span>
                  Start your Next.js 16 dev server with{" "}
                  <code className="text-cyan-400 bg-black/30 px-2 py-1 rounded">next dev</code>
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-cyan-400 font-bold">2.</span>
                <span>
                  MCP endpoint is automatically available at{" "}
                  <code className="text-cyan-400 bg-black/30 px-2 py-1 rounded">
                    http://localhost:3000/_next/mcp
                  </code>
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-cyan-400 font-bold">3.</span>
                <span>
                  Ask Claude Code to query runtime information using{" "}
                  <code className="text-cyan-400 bg-black/30 px-2 py-1 rounded">
                    nextjs_runtime
                  </code>{" "}
                  tool
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-cyan-400 font-bold">4.</span>
                <span>AI can now debug, inspect, and understand your app in real-time</span>
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: string;
}) {
  return (
    <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-6">
      <div className="text-4xl mb-3">{icon}</div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-gray-400 text-sm">{description}</p>
    </div>
  );
}

function CodeBlock({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="p-4 bg-black/30 rounded-lg border border-gray-700">
      <code className="text-cyan-400 font-mono">{title}</code>
      <p className="text-gray-400 text-sm mt-1">{description}</p>
    </div>
  );
}
