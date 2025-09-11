"use client"

import { useState, useTransition } from "react"
import { stateUpdateAction } from "./actions"

interface Task {
  id: number
  title: string
  description: string
  status: string
  createdAt: string
}

export default function StateUpdateForm() {
  const [isPending, startTransition] = useTransition()
  const [tasks, setTasks] = useState<Task[]>([])
  const [serverResponse, setServerResponse] = useState<string>("")
  const [clientError, setClientError] = useState<string>("")

  const handleSubmit = async (formData: FormData) => {
    console.log("[CLIENT] State update form submission started")
    setServerResponse("")
    setClientError("")

    startTransition(async () => {
      try {
        console.log("[CLIENT] Calling stateUpdateAction...")
        const response = await stateUpdateAction(formData)

        console.log("[CLIENT] Server action completed successfully:", response)
        setServerResponse(`Server created task: ${JSON.stringify(response.task)}`)

        // Now try to update client state - this will have bugs
        if (response.success && response.task) {
          console.log("[CLIENT] Attempting to update local state...")

          // Bug 1: Random chance of accessing undefined property
          if (Math.random() < 0.3) {
            console.log("[CLIENT] Simulating state update error...")
            // @ts-expect-error - intentionally accessing undefined property
            const brokenValue = response.task.nonexistentProperty.value
            console.log("This will never execute:", brokenValue)
          }

          // Bug 2: Mutation instead of immutable update (React might not re-render)
          if (Math.random() < 0.3) {
            console.log("[CLIENT] Using buggy state mutation...")
            tasks.push(response.task) // This is wrong! Should use setTasks with new array
            console.log("[CLIENT] State mutated directly (bad practice)")
          } else {
            // Correct state update
            setTasks((prev) => {
              console.log("[CLIENT] Adding task to state correctly")
              return [...prev, response.task]
            })
          }

          // Bug 3: Race condition with multiple state updates
          if (Math.random() < 0.4) {
            console.log("[CLIENT] Creating race condition with delayed state update...")
            setTimeout(() => {
              // This delayed update might overwrite the previous state
              setTasks((currentTasks) => {
                console.log("[CLIENT] Delayed state update executing (potential race condition)")
                // This might overwrite the state if user has interacted with form again
                return [
                  ...currentTasks,
                  {
                    ...response.task,
                    title: response.task.title + " (DELAYED UPDATE)"
                  }
                ]
              })
            }, 2000)
          }

          // Bug 4: Incorrect state update logic
          if (Math.random() < 0.2) {
            console.log("[CLIENT] Using incorrect state update logic...")
            setTasks(response.task) // This is wrong! Setting single task instead of array
          }
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error"
        console.error("[CLIENT] Error in state update process:", errorMessage)
        setClientError(errorMessage)
      }
    })
  }

  const clearTasks = () => {
    console.log("[CLIENT] Clearing tasks")
    setTasks([])
    setServerResponse("")
    setClientError("")
  }

  return (
    <div className="space-y-4">
      <form action={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Task Title</label>
          <input
            name="title"
            type="text"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
            placeholder="Enter task title"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            name="description"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
            placeholder="Enter task description"
            rows={3}
            required
          />
        </div>

        <div className="flex space-x-2">
          <button
            type="submit"
            disabled={isPending}
            className="flex-1 bg-purple-600 text-white py-2 px-4 rounded-md hover:bg-purple-700 disabled:opacity-50"
          >
            {isPending ? "Creating Task..." : "Create Task"}
          </button>

          <button
            type="button"
            onClick={clearTasks}
            className="bg-gray-600 text-white py-2 px-4 rounded-md hover:bg-gray-700"
          >
            Clear
          </button>
        </div>
      </form>

      {/* Server response */}
      {serverResponse && (
        <div className="p-4 bg-blue-100 border border-blue-200 rounded-md">
          <h4 className="font-semibold text-blue-800 mb-1">📡 Server Response:</h4>
          <p className="text-blue-700 text-sm font-mono">{serverResponse}</p>
        </div>
      )}

      {/* Client error */}
      {clientError && (
        <div className="p-4 bg-red-100 border border-red-200 rounded-md">
          <h4 className="font-semibold text-red-800 mb-1">❌ Client State Error:</h4>
          <p className="text-red-700 text-sm">{clientError}</p>
        </div>
      )}

      {/* Task list */}
      {tasks.length > 0 && (
        <div className="p-4 bg-green-100 border border-green-200 rounded-md">
          <h4 className="font-semibold text-green-800 mb-2">📋 Tasks in Client State ({tasks.length}):</h4>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {tasks.map((task, index) => (
              <div key={`${task.id}-${index}`} className="bg-green-50 p-2 rounded text-sm">
                <strong className="text-green-800">{task.title}</strong>
                <p className="text-green-700 text-xs">{task.description}</p>
                <p className="text-green-600 text-xs">
                  ID: {task.id} | Status: {task.status}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="p-3 bg-gray-50 rounded-md">
        <h4 className="font-medium text-gray-800 text-sm mb-1">🐛 State Update Bugs:</h4>
        <ul className="text-gray-600 text-xs space-y-1">
          <li>• 30% chance of accessing undefined properties</li>
          <li>• 30% chance of direct state mutation (React anti-pattern)</li>
          <li>• 40% chance of race condition with delayed updates</li>
          <li>• 20% chance of incorrect state type (object instead of array)</li>
          <li>• Server action always succeeds, but client state may fail</li>
        </ul>
      </div>
    </div>
  )
}
