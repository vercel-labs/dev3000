import Link from "next/link"

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">🐛 Next.js Bug Demo App</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            This app contains intentional bugs to test dev3000's debugging capabilities. Each page demonstrates a
            different type of common Next.js error.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/hydration-mismatch"
            className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow border-l-4 border-red-500"
          >
            <h2 className="text-xl font-semibold text-gray-900 mb-2">💧 Hydration Mismatch</h2>
            <p className="text-gray-600 mb-4">Server and client render different content, causing hydration errors.</p>
            <span className="text-red-600 font-medium">Client-side Error</span>
          </Link>

          <Link
            href="/server-client-boundary"
            className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow border-l-4 border-orange-500"
          >
            <h2 className="text-xl font-semibold text-gray-900 mb-2">🚧 Server/Client Boundary</h2>
            <p className="text-gray-600 mb-4">Client component tries to use server-only APIs like headers().</p>
            <span className="text-orange-600 font-medium">Server-side Error</span>
          </Link>

          <Link
            href="/event-handler-error"
            className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow border-l-4 border-purple-500"
          >
            <h2 className="text-xl font-semibold text-gray-900 mb-2">🎯 Event Handler Error</h2>
            <p className="text-gray-600 mb-4">JavaScript error in a click handler that breaks user interaction.</p>
            <span className="text-purple-600 font-medium">Runtime Error</span>
          </Link>

          <Link
            href="/async-error"
            className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow border-l-4 border-blue-500"
          >
            <h2 className="text-xl font-semibold text-gray-900 mb-2">⚡ Async Code Error</h2>
            <p className="text-gray-600 mb-4">Unhandled promise rejection and async function errors.</p>
            <span className="text-blue-600 font-medium">Async Error</span>
          </Link>

          <Link
            href="/suspense-boundary"
            className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow border-l-4 border-green-500"
          >
            <h2 className="text-xl font-semibold text-gray-900 mb-2">⏳ Suspense Boundary Issues</h2>
            <p className="text-gray-600 mb-4">
              Suspense boundaries that never resolve, error boundaries that don't catch, and timing issues.
            </p>
            <span className="text-green-600 font-medium">Server/Client Timing</span>
          </Link>

          <Link
            href="/server-action-state"
            className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow border-l-4 border-teal-500"
          >
            <h2 className="text-xl font-semibold text-gray-900 mb-2">🔄 Server Actions + State</h2>
            <p className="text-gray-600 mb-4">
              Server action failures with client state updates and form submission errors.
            </p>
            <span className="text-teal-600 font-medium">Server/Client Interaction</span>
          </Link>
        </div>

        <div className="mt-12 p-6 bg-yellow-50 border border-yellow-200 rounded-lg">
          <h3 className="text-lg font-semibold text-yellow-800 mb-2">🎯 Testing with dev3000</h3>
          <p className="text-yellow-700 mb-4">To test these bugs with dev3000:</p>
          <ol className="list-decimal list-inside space-y-1 text-yellow-700 text-sm">
            <li>
              Run <code className="bg-yellow-100 px-1 rounded">dev3000</code> in this directory
            </li>
            <li>Visit each page to trigger the bugs</li>
            <li>Use Claude with MCP integration to analyze the logs</li>
            <li>Let AI help debug and fix the issues</li>
            <li>Reset with the reset script when done testing</li>
          </ol>
        </div>
      </div>
    </div>
  )
}
