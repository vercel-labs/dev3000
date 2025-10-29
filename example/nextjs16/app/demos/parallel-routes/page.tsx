import Link from "next/link";

export default function ParallelRoutesDemo() {
  return (
    <>
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 mb-8 transition-colors"
      >
        ← Back to Home
      </Link>

      <div className="max-w-4xl mx-auto mb-8">
        <h1 className="text-4xl font-bold text-white mb-4">Parallel Routes Demo</h1>
        <p className="text-gray-400 mb-8">
          Load multiple pages in the same route simultaneously with independent loading states
        </p>

        <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-8 backdrop-blur-sm">
          <h2 className="text-2xl font-bold text-white mb-4">What are Parallel Routes?</h2>

          <div className="space-y-4 text-gray-300">
            <p>
              Parallel routes allow you to simultaneously render multiple pages within the same
              layout. Each parallel route can have its own loading and error states.
            </p>

            <p>
              This demo shows two parallel routes:{" "}
              <code className="text-cyan-400 bg-black/30 px-2 py-1 rounded">@analytics</code> and{" "}
              <code className="text-cyan-400 bg-black/30 px-2 py-1 rounded">@notifications</code>,
              each loading independently below.
            </p>
          </div>

          <div className="mt-6 bg-gray-900/50 border border-gray-600 rounded-lg p-4">
            <h3 className="text-white font-semibold mb-3">Features</h3>
            <ul className="space-y-2 text-gray-400">
              <li className="flex gap-2">
                <span className="text-cyan-400">✓</span>
                <span>Independent loading and error states</span>
              </li>
              <li className="flex gap-2">
                <span className="text-cyan-400">✓</span>
                <span>Conditional rendering based on route segments</span>
              </li>
              <li className="flex gap-2">
                <span className="text-cyan-400">✓</span>
                <span>Complex dashboard layouts</span>
              </li>
              <li className="flex gap-2">
                <span className="text-cyan-400">✓</span>
                <span>Modal and intercepting routes</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

