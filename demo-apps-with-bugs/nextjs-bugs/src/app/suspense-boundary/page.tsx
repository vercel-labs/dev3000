import Link from "next/link"
import { Suspense } from "react"
import SuspenseErrorBoundary from "./error-boundary"
import FailingComponent from "./failing-component"
import NestedSuspenseComponent from "./nested-suspense-component"
import SlowComponent from "./slow-component"

export default function SuspenseBoundaryPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4">
        <div className="mb-8">
          <Link href="/" className="text-blue-600 hover:text-blue-800 font-medium">
            ← Back to Home
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8">
          <h1 className="text-3xl font-bold text-green-600 mb-4">⏳ Suspense Boundary Issues</h1>

          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
            <h2 className="text-lg font-semibold text-green-800 mb-2">What's happening?</h2>
            <p className="text-green-700 mb-4">
              This page demonstrates complex Suspense boundary issues that are notoriously hard to debug because they
              involve timing between server-side rendering, client-side hydration, async data fetching, and error
              boundaries. You need consolidated logs to see the full picture of what's happening on both server and
              client.
            </p>
          </div>

          <div className="space-y-8">
            {/* Suspense that never resolves */}
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="font-semibold text-gray-800 mb-2">🔄 Suspense That Never Resolves</h3>
              <p className="text-gray-600 text-sm mb-4">
                This Suspense boundary will show a fallback but the component inside will never finish loading due to an
                infinite promise.
              </p>
              <Suspense
                fallback={
                  <div className="animate-pulse p-4 bg-blue-100 rounded">
                    <p className="text-blue-700">⏳ Loading forever... (this will never resolve)</p>
                  </div>
                }
              >
                <SlowComponent delay="infinite" />
              </Suspense>
            </div>

            {/* Suspense with component that throws after delay */}
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="font-semibold text-gray-800 mb-2">💥 Suspense + Error Boundary Interaction</h3>
              <p className="text-gray-600 text-sm mb-4">
                This component will suspend, then throw an error. The error boundary should catch it, but timing issues
                can cause problems.
              </p>
              <SuspenseErrorBoundary>
                <Suspense
                  fallback={
                    <div className="animate-pulse p-4 bg-yellow-100 rounded">
                      <p className="text-yellow-700">⏳ Loading component that will fail...</p>
                    </div>
                  }
                >
                  <FailingComponent />
                </Suspense>
              </SuspenseErrorBoundary>
            </div>

            {/* Nested Suspense boundaries with timing issues */}
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="font-semibold text-gray-800 mb-2">🎯 Nested Suspense Timing Issues</h3>
              <p className="text-gray-600 text-sm mb-4">
                Multiple nested Suspense boundaries with different loading times can cause race conditions and hydration
                issues.
              </p>
              <Suspense
                fallback={
                  <div className="p-4 bg-purple-100 rounded">
                    <p className="text-purple-700">⏳ Loading outer boundary...</p>
                  </div>
                }
              >
                <NestedSuspenseComponent />
              </Suspense>
            </div>

            {/* Server vs Client Suspense differences */}
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="font-semibold text-gray-800 mb-2">🔀 Server vs Client Suspense Differences</h3>
              <p className="text-gray-600 text-sm mb-4">
                This will behave differently on server vs client, potentially causing hydration mismatches with Suspense
                boundaries.
              </p>
              <Suspense
                fallback={
                  <div className="p-4 bg-orange-100 rounded">
                    <p className="text-orange-700">⏳ SSR vs CSR timing difference...</p>
                  </div>
                }
              >
                <SlowComponent delay={2000} />
              </Suspense>
            </div>
          </div>

          <div className="mt-8 p-4 bg-gray-100 rounded-lg">
            <h3 className="font-semibold text-gray-800 mb-2">Why dev3000's consolidated logs help:</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• See server-side rendering decisions alongside client-side hydration</li>
              <li>• Track async data fetching timing and failures</li>
              <li>• Monitor error boundary interactions with Suspense</li>
              <li>• Observe differences between SSR and CSR Suspense behavior</li>
              <li>• Identify race conditions between nested boundaries</li>
              <li>• Correlate network requests with Suspense state changes</li>
            </ul>
          </div>

          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <h3 className="font-semibold text-green-800 mb-2">Expected Issues:</h3>
            <ul className="text-sm text-green-700 space-y-1">
              <li>• Suspense fallbacks that never resolve</li>
              <li>• Error boundaries not catching Suspense-related errors</li>
              <li>• Hydration mismatches with Suspense boundaries</li>
              <li>• Race conditions between nested Suspense components</li>
              <li>• Timing differences between server and client rendering</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
