import Link from "next/link"
import ClientComponentWithBoundaryViolation from "./client-component"

export default function ServerClientBoundaryPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4">
        <div className="mb-8">
          <Link href="/" className="text-blue-600 hover:text-blue-800 font-medium">
            ← Back to Home
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8">
          <h1 className="text-3xl font-bold text-orange-600 mb-4">🚧 Server/Client Boundary Violation</h1>

          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-6">
            <h2 className="text-lg font-semibold text-orange-800 mb-2">What's happening?</h2>
            <p className="text-orange-700 mb-4">
              This page contains a client component that tries to use server-only APIs like
              <code className="bg-orange-100 px-1 rounded mx-1">headers()</code> from Next.js. This violates the
              server/client boundary and will cause a runtime error.
            </p>
          </div>

          <div className="mb-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Client Component (with boundary violation):</h2>

            {/* This client component will try to use server-only APIs */}
            <ClientComponentWithBoundaryViolation />
          </div>

          <div className="mt-8 p-4 bg-gray-100 rounded-lg">
            <h3 className="font-semibold text-gray-800 mb-2">Expected Errors:</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Runtime error when client component tries to call headers()</li>
              <li>• "headers() can only be called in server components" error</li>
              <li>• Component will fail to render properly</li>
              <li>• Error boundary may catch the error</li>
            </ul>
          </div>

          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="font-semibold text-blue-800 mb-2">How to fix:</h3>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>• Move server-only API calls to server components</li>
              <li>• Pass data as props from server to client components</li>
              <li>• Use Next.js data fetching patterns correctly</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
