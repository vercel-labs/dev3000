"use client"

import { useState, useTransition } from "react"
import { buggyFormAction } from "./actions"

export default function FormWithBuggyAction() {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string>("")

  const handleSubmit = async (formData: FormData) => {
    console.log("[CLIENT] Form submission started")
    setResult(null)
    setError("")

    startTransition(async () => {
      try {
        console.log("[CLIENT] Calling server action...")
        const response = await buggyFormAction(formData)

        console.log("[CLIENT] Server action response:", response)

        if (response.success) {
          setResult(response)
          console.log("[CLIENT] Success state updated")
        } else {
          setError(response.error || "Unknown error")
          console.log("[CLIENT] Error state updated:", response.error)
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error occurred"
        console.error("[CLIENT] Server action threw error:", errorMessage)
        setError(errorMessage)

        // This is a bug - we're accessing a property that might not exist
        // @ts-expect-error
        console.log("[CLIENT] Trying to access error details:", err.details.stackTrace)
      }
    })
  }

  return (
    <div className="space-y-4">
      <form action={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            name="name"
            type="text"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter your name"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            name="email"
            type="email"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter your email"
            required
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? "Processing..." : "Submit (May Fail)"}
        </button>
      </form>

      {/* Results and errors */}
      {error && (
        <div className="p-4 bg-red-100 border border-red-200 rounded-md">
          <h4 className="font-semibold text-red-800 mb-1">❌ Error Occurred</h4>
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {result && result.success && (
        <div className="p-4 bg-green-100 border border-green-200 rounded-md">
          <h4 className="font-semibold text-green-800 mb-1">✅ Success!</h4>
          <p className="text-green-700 text-sm mb-2">{result.message}</p>
          <div className="text-green-600 text-xs">
            <strong>Data:</strong> {JSON.stringify(result.data)}
          </div>
        </div>
      )}

      {isPending && (
        <div className="p-4 bg-yellow-100 border border-yellow-200 rounded-md">
          <p className="text-yellow-700 text-sm">🔄 Processing on server... Check logs for server action execution</p>
        </div>
      )}

      <div className="p-3 bg-gray-50 rounded-md">
        <h4 className="font-medium text-gray-800 text-sm mb-1">🐛 Bugs in this form:</h4>
        <ul className="text-gray-600 text-xs space-y-1">
          <li>• 30% chance of server validation failure</li>
          <li>• 20% chance of server error</li>
          <li>• 20% chance of email validation error</li>
          <li>• Client tries to access undefined error properties</li>
          <li>• No proper error boundary handling</li>
        </ul>
      </div>
    </div>
  )
}
