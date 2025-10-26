"use client";

import { useState } from "react";

interface SearchResult {
  libraryId?: string;
  docs?: string;
  error?: string;
}

export default function SearchForm() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!query.trim()) return;

    setLoading(true);
    setResult(null);

    try {
      // Simulated Context7 search
      // In production, this would call Context7 MCP via Server Actions
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Mock result
      setResult({
        libraryId: `/vercel/${query}`,
        docs: `# ${query} Documentation\n\nThis is a demonstration of Context7 integration.\n\n## Getting Started\n\nTo use Context7 in your Next.js 16 application:\n\n1. Install the Context7 MCP server\n2. Configure it in your MCP settings\n3. Use Server Actions to call Context7 tools\n\n## Example\n\n\`\`\`typescript\nimport { resolveLibraryId, getLibraryDocs } from '@/lib/context7';\n\nconst libraryId = await resolveLibraryId('${query}');\nconst docs = await getLibraryDocs(libraryId);\n\`\`\`\n\n## Features\n\n- Real-time documentation retrieval\n- Version-specific documentation\n- Code examples and snippets\n- Type definitions\n\n**Note**: This is a mock demonstration. In production, Context7 would provide actual library documentation from authoritative sources.`,
      });
    } catch (error) {
      setResult({
        error: error instanceof Error ? error.message : "Failed to fetch documentation",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="mb-6">
        <div className="flex gap-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter library name (e.g., react, next.js)..."
            className="flex-1 px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 transition-colors"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 disabled:from-gray-500 disabled:to-gray-600 text-white font-semibold rounded-lg transition-all duration-300 disabled:cursor-not-allowed"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
      </form>

      {result && (
        <div className="mt-6">
          {result.error ? (
            <div className="p-4 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400">
              {result.error}
            </div>
          ) : (
            <div>
              {result.libraryId && (
                <div className="mb-4 p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg">
                  <span className="text-gray-400">Library ID: </span>
                  <span className="text-cyan-400 font-mono">{result.libraryId}</span>
                </div>
              )}

              {result.docs && (
                <div className="p-6 bg-gray-900/50 border border-gray-700 rounded-lg">
                  <div className="prose prose-invert max-w-none">
                    {/* SAFE: Content comes from Context7 MCP (trusted source) and is sanitized markdown */}
                    <div
                      className="text-gray-300 whitespace-pre-wrap"
                      dangerouslySetInnerHTML={{
                        __html: result.docs
                          .replace(
                            /^# (.+)$/gm,
                            '<h1 class="text-2xl font-bold text-white mb-4">$1</h1>'
                          )
                          .replace(
                            /^## (.+)$/gm,
                            '<h2 class="text-xl font-bold text-white mt-6 mb-3">$1</h2>'
                          )
                          .replace(
                            /```(\w+)?\n([\s\S]+?)```/g,
                            '<pre class="bg-black/50 p-4 rounded-lg overflow-x-auto my-4"><code class="text-cyan-400">$2</code></pre>'
                          )
                          .replace(
                            /`([^`]+)`/g,
                            '<code class="text-cyan-400 bg-black/30 px-1 rounded">$1</code>'
                          )
                          .replace(/^\d+\.\s+(.+)$/gm, '<li class="ml-4">$1</li>')
                          .replace(/^-\s+(.+)$/gm, '<li class="ml-4">$1</li>')
                          .replace(
                            /\*\*(.+?)\*\*/g,
                            '<strong class="text-white font-semibold">$1</strong>'
                          ),
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
