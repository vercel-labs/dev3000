import Link from "next/link";
import SearchForm from "./SearchForm";

export default function Context7Demo() {
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
          <h1 className="text-4xl font-bold text-white mb-4">Context7 Integration</h1>
          <p className="text-gray-400 mb-8">
            Search and retrieve real-time library documentation using Context7 MCP
          </p>

          <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-8 backdrop-blur-sm mb-8">
            <h2 className="text-2xl font-bold text-white mb-6">Library Documentation Search</h2>

            <SearchForm />
          </div>

          <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-6 mb-8">
            <h3 className="text-white font-semibold mb-3">How It Works</h3>
            <ul className="space-y-2 text-gray-400">
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">1.</span>
                <span>Enter a library name (e.g., "react", "next.js", "tailwindcss")</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">2.</span>
                <span>Context7 MCP resolves the library ID and fetches documentation</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">3.</span>
                <span>Documentation is displayed with syntax highlighting and examples</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">4.</span>
                <span>All data is fetched in real-time from the latest sources</span>
              </li>
            </ul>
          </div>

          <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-3">Features Demonstrated</h3>
            <ul className="space-y-2 text-gray-400">
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">✓</span>
                <span>Context7 MCP integration for library documentation</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">✓</span>
                <span>Real-time documentation search and retrieval</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">✓</span>
                <span>Server Actions for data fetching</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">✓</span>
                <span>Streaming responses for better UX</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">✓</span>
                <span>Type-safe MCP tool invocation</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
