"use client"

import { useState, useTransition } from "react"
import { conflictAction, raceConditionAction } from "./actions"

interface ActionResult {
  actionId: string
  counter: number
  processedAt: string
  startedAt: string
}

export default function RaceConditionForm() {
  const [isPending, startTransition] = useTransition()
  const [counter, setCounter] = useState(0)
  const [results, setResults] = useState<ActionResult[]>([])
  const [version, setVersion] = useState(Math.floor(Date.now() / 10000))
  const [data, setData] = useState("Sample data")
  const [conflictError, setConflictError] = useState<string>("")

  const handleRapidIncrements = () => {
    console.log("[CLIENT] Starting rapid increments (potential race condition)")
    setResults([])

    // Fire off 3 server actions rapidly - this creates race conditions
    for (let i = 0; i < 3; i++) {
      const startTime = new Date().toISOString()

      startTransition(async () => {
        try {
          console.log(`[CLIENT] Starting action ${i + 1} with counter:`, counter)

          const formData = new FormData()
          formData.append("counter", counter.toString())

          const response = await raceConditionAction(formData)

          if (response.success) {
            console.log(`[CLIENT] Action ${i + 1} completed:`, response)

            // Update counter based on server response
            // Bug: Last response wins, but actions might complete out of order
            setCounter(response.counter)

            // Track results
            setResults((prev) => [
              ...prev,
              {
                actionId: response.actionId,
                counter: response.counter,
                processedAt: response.processedAt,
                startedAt: startTime
              }
            ])
          }
        } catch (err) {
          console.error(`[CLIENT] Action ${i + 1} failed:`, err)
        }
      })
    }
  }

  const handleConflictTest = () => {
    console.log("[CLIENT] Testing version conflict scenario")
    setConflictError("")

    startTransition(async () => {
      try {
        const formData = new FormData()
        formData.append("version", version.toString())
        formData.append("data", data)

        console.log("[CLIENT] Sending conflict action with version:", version)
        const response = await conflictAction(formData)

        if (response.success) {
          console.log("[CLIENT] Conflict action succeeded:", response)
          setVersion(response.newVersion)
          setData(data + " (updated)")
        } else {
          console.log("[CLIENT] Version conflict detected:", response)
          setConflictError(response.error)

          // Bug: Update version but don't handle the conflict properly
          setVersion(response.currentVersion)

          // This creates a potential race condition if user clicks multiple times
          setTimeout(() => {
            console.log("[CLIENT] Auto-retrying after version conflict...")
            // Recursive retry without proper backoff - can cause more conflicts
            handleConflictTest()
          }, 100)
        }
      } catch (err) {
        console.error("[CLIENT] Conflict action error:", err)
        setConflictError(err instanceof Error ? err.message : "Unknown error")
      }
    })
  }

  const resetState = () => {
    setCounter(0)
    setResults([])
    setVersion(Math.floor(Date.now() / 10000))
    setData("Sample data")
    setConflictError("")
  }

  return (
    <div className="space-y-6">
      {/* Race condition with counter */}
      <div className="border border-orange-200 rounded-lg p-4">
        <h4 className="font-semibold text-orange-800 mb-3">🏃‍♂️ Rapid Counter Increments</h4>

        <div className="flex items-center space-x-4 mb-4">
          <div className="text-2xl font-bold text-orange-700">Counter: {counter}</div>
          <button
            onClick={handleRapidIncrements}
            disabled={isPending}
            className="bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700 disabled:opacity-50"
          >
            Fire 3 Actions Rapidly
          </button>
        </div>

        {results.length > 0 && (
          <div className="bg-orange-50 rounded p-3">
            <h5 className="font-medium text-orange-800 mb-2">Action Results (may be out of order):</h5>
            <div className="space-y-1 text-xs">
              {results.map((result, index) => (
                <div key={index} className="flex justify-between text-orange-700">
                  <span>
                    Action {result.actionId}: Counter → {result.counter}
                  </span>
                  <span>Completed: {new Date(result.processedAt).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Version conflicts */}
      <div className="border border-red-200 rounded-lg p-4">
        <h4 className="font-semibold text-red-800 mb-3">⚡ Version Conflict Simulation</h4>

        <div className="space-y-3 mb-4">
          <div className="flex items-center space-x-4">
            <span className="text-sm text-red-700">Version: {version}</span>
            <input
              value={data}
              onChange={(e) => setData(e.target.value)}
              className="flex-1 px-3 py-1 border border-red-300 rounded text-sm"
              placeholder="Data to update"
            />
          </div>

          <button
            onClick={handleConflictTest}
            disabled={isPending}
            className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 disabled:opacity-50"
          >
            Test Version Conflict
          </button>
        </div>

        {conflictError && (
          <div className="bg-red-50 border border-red-200 rounded p-3">
            <h5 className="font-medium text-red-800 mb-1">Version Conflict:</h5>
            <p className="text-red-700 text-sm">{conflictError}</p>
          </div>
        )}
      </div>

      {/* Control buttons */}
      <div className="flex space-x-2">
        <button onClick={resetState} className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700">
          Reset All
        </button>
      </div>

      {isPending && (
        <div className="p-4 bg-yellow-100 border border-yellow-200 rounded-md">
          <p className="text-yellow-700 text-sm">
            🔄 Server actions in progress... Multiple actions may be running simultaneously
          </p>
        </div>
      )}

      <div className="p-3 bg-gray-50 rounded-md">
        <h4 className="font-medium text-gray-800 text-sm mb-1">🐛 Race Condition Bugs:</h4>
        <ul className="text-gray-600 text-xs space-y-1">
          <li>• Multiple server actions fired simultaneously</li>
          <li>• Actions may complete in different order than started</li>
          <li>• Client state updated by "last response wins" - not chronological order</li>
          <li>• Version conflicts cause recursive retries without backoff</li>
          <li>• No proper locking or queuing mechanism</li>
          <li>• State updates from different actions can overwrite each other</li>
        </ul>
      </div>
    </div>
  )
}
