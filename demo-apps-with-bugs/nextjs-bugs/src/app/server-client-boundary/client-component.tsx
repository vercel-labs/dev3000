"use client"

import { headers } from "next/headers"
import { useState } from "react"

export default function ClientComponentWithBoundaryViolation() {
  const [userAgent, setUserAgent] = useState<string>("Not loaded")
  const [error, setError] = useState<string>("")

  const handleGetHeaders = async () => {
    try {
      // This will cause an error because headers() is server-only
      // but we're in a client component
      const headersList = await headers()
      const ua = headersList.get("user-agent") || "Unknown"
      setUserAgent(ua)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    }
  }

  // This will also cause an error because headers() can't be called in client components
  let immediateError = ""
  try {
    headers() // This line will cause an immediate error
  } catch (err) {
    immediateError = err instanceof Error ? err.message : "Unknown error"
  }

  return (
    <div className="space-y-4">
      <div className="p-4 bg-red-100 border border-red-200 rounded-lg">
        <h3 className="font-semibold text-red-800 mb-2">🚨 Immediate Error (headers() called directly):</h3>
        <p className="text-red-700 text-sm font-mono break-words">{immediateError || "No error (unexpected)"}</p>
      </div>

      <div className="p-4 bg-yellow-100 border border-yellow-200 rounded-lg">
        <h3 className="font-semibold text-yellow-800 mb-2">Try to get User Agent (will fail):</h3>
        <button
          onClick={handleGetHeaders}
          className="bg-yellow-600 text-white px-4 py-2 rounded hover:bg-yellow-700 mb-2"
        >
          Get Headers (Will Error)
        </button>

        {error && (
          <div className="mt-2 p-2 bg-red-100 rounded">
            <p className="text-red-700 text-sm font-mono break-words">{error}</p>
          </div>
        )}

        <p className="text-yellow-700 text-sm">
          Current User Agent: <span className="font-mono">{userAgent}</span>
        </p>
      </div>

      <div className="p-4 bg-gray-100 rounded-lg">
        <h3 className="font-semibold text-gray-800 mb-2">This is a Client Component</h3>
        <p className="text-gray-600 text-sm">
          Client components run in the browser and cannot access server-only APIs like
          <code className="bg-gray-200 px-1 rounded mx-1">headers()</code>,
          <code className="bg-gray-200 px-1 rounded mx-1">cookies()</code>, or database connections.
        </p>
      </div>
    </div>
  )
}
