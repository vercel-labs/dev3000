"use client"

import Link from "next/link"
import { useState } from "react"

export default function AsyncErrorPage() {
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<string[]>([])

  const handlePromiseRejection = async () => {
    setLoading(true)
    // Unhandled promise rejection
    Promise.reject(new Error("Unhandled promise rejection"))

    setTimeout(() => setLoading(false), 1000)
  }

  const handleAsyncAwaitError = async () => {
    setLoading(true)
    try {
      // This will cause an error in async function
      const response = await fetch("/nonexistent-endpoint")
      if (!response.ok) {
        throw new Error("Network error")
      }
    } catch (error) {
      // Re-throw to make it unhandled
      setTimeout(() => {
        throw error
      }, 0)
    } finally {
      setLoading(false)
    }
  }

  const handleFakeAPICall = async () => {
    setLoading(true)
    const fakeAPICall = new Promise((resolve, reject) => {
      setTimeout(() => {
        // Randomly reject to simulate API failures
        if (Math.random() > 0.5) {
          reject(new Error("API call failed randomly"))
        } else {
          resolve("Success")
        }
      }, 1000)
    })

    // Don't catch the error - let it bubble up
    fakeAPICall
      .then((result) => {
        setResults((prev) => [...prev, `✅ ${result}`])
      })
      .finally(() => {
        setLoading(false)
      })
    // Missing .catch() - this will cause unhandled rejection when it fails
  }

  const handleChainedErrors = async () => {
    setLoading(true)

    const step1 = () => Promise.reject(new Error("Step 1 failed"))
    const step2 = () => Promise.reject(new Error("Step 2 failed"))
    const step3 = () => Promise.reject(new Error("Step 3 failed"))

    // Chain promises without proper error handling
    step1()
      .then(() => step2())
      .then(() => step3())
      .then((result) => {
        setResults((prev) => [...prev, `✅ All steps completed: ${result}`])
      })
      .finally(() => setLoading(false))
    // Missing .catch() - all errors will be unhandled
  }

  const handleAsyncIterationError = async () => {
    setLoading(true)

    const items = [1, 2, 3, 4, 5]

    // Process items with async operations
    items.forEach(async (item) => {
      await new Promise((resolve) => setTimeout(resolve, 100))

      if (item === 3) {
        // This error won't be caught properly in forEach
        throw new Error(`Processing failed for item ${item}`)
      }

      setResults((prev) => [...prev, `Processed item ${item}`])
    })

    setTimeout(() => setLoading(false), 1000)
  }

  const handleTimeoutError = () => {
    setLoading(true)

    // Create a promise that will timeout
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(resolve, 5000) // 5 second timeout
    })

    const quickOperation = new Promise((resolve, reject) => {
      setTimeout(() => {
        reject(new Error("Quick operation failed before timeout"))
      }, 1000)
    })

    // Race conditions can cause unhandled rejections
    Promise.race([timeoutPromise, quickOperation])
      .then(() => {
        setResults((prev) => [...prev, "✅ Operation completed"])
      })
      .finally(() => setLoading(false))
    // Missing catch - rejection from quickOperation will be unhandled
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4">
        <div className="mb-8">
          <Link href="/" className="text-blue-600 hover:text-blue-800 font-medium">
            ← Back to Home
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8">
          <h1 className="text-3xl font-bold text-blue-600 mb-4">⚡ Async Code Errors</h1>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <h2 className="text-lg font-semibold text-blue-800 mb-2">What's happening?</h2>
            <p className="text-blue-700 mb-4">
              This page demonstrates common async programming errors including unhandled promise rejections, missing
              error handling, and race conditions that can cause silent failures or console errors.
            </p>
          </div>

          {loading && (
            <div className="mb-4 p-4 bg-yellow-100 border border-yellow-200 rounded-lg">
              <p className="text-yellow-800">🔄 Processing... (check console for errors)</p>
            </div>
          )}

          <div className="mb-6 grid gap-4 md:grid-cols-2">
            <button
              onClick={handlePromiseRejection}
              disabled={loading}
              className="bg-red-500 text-white px-4 py-3 rounded hover:bg-red-600 disabled:opacity-50"
            >
              🚫 Unhandled Promise Rejection
              <div className="text-xs mt-1">Promise.reject() without catch</div>
            </button>

            <button
              onClick={handleAsyncAwaitError}
              disabled={loading}
              className="bg-orange-500 text-white px-4 py-3 rounded hover:bg-orange-600 disabled:opacity-50"
            >
              🌐 Fetch Error (async/await)
              <div className="text-xs mt-1">Network error re-thrown async</div>
            </button>

            <button
              onClick={handleFakeAPICall}
              disabled={loading}
              className="bg-purple-500 text-white px-4 py-3 rounded hover:bg-purple-600 disabled:opacity-50"
            >
              🎲 Random API Failure
              <div className="text-xs mt-1">50% chance of unhandled rejection</div>
            </button>

            <button
              onClick={handleChainedErrors}
              disabled={loading}
              className="bg-pink-500 text-white px-4 py-3 rounded hover:bg-pink-600 disabled:opacity-50"
            >
              ⛓️ Chained Promise Errors
              <div className="text-xs mt-1">Multiple steps without error handling</div>
            </button>

            <button
              onClick={handleAsyncIterationError}
              disabled={loading}
              className="bg-indigo-500 text-white px-4 py-3 rounded hover:bg-indigo-600 disabled:opacity-50"
            >
              🔄 Async forEach Error
              <div className="text-xs mt-1">Error in async iteration</div>
            </button>

            <button
              onClick={handleTimeoutError}
              disabled={loading}
              className="bg-gray-500 text-white px-4 py-3 rounded hover:bg-gray-600 disabled:opacity-50"
            >
              ⏱️ Race Condition Error
              <div className="text-xs mt-1">Promise.race() without catch</div>
            </button>
          </div>

          {results.length > 0 && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <h3 className="font-semibold text-green-800 mb-2">Results:</h3>
              <ul className="text-sm text-green-700 space-y-1">
                {results.map((result, index) => (
                  <li key={index}>• {result}</li>
                ))}
              </ul>
              <button
                onClick={() => setResults([])}
                className="mt-2 text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700"
              >
                Clear Results
              </button>
            </div>
          )}

          <div className="mt-8 p-4 bg-gray-100 rounded-lg">
            <h3 className="font-semibold text-gray-800 mb-2">Expected Errors:</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Unhandled Promise Rejection warnings</li>
              <li>• Network errors (404, fetch failures)</li>
              <li>• Async/await errors without proper try-catch</li>
              <li>• Race condition failures</li>
              <li>• Silent failures in forEach async operations</li>
            </ul>
          </div>

          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <h3 className="font-semibold text-red-800 mb-2">Monitoring Tips:</h3>
            <p className="text-red-700 text-sm">
              These async errors often appear as "Uncaught (in promise)" messages in the console. Some may only show
              warnings rather than throwing exceptions. dev3000 should capture these for AI analysis.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
