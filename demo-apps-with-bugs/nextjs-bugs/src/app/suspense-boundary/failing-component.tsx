"use client"

import { use } from "react"

// Create a promise that will reject after suspending for a bit
const createFailingPromise = () => {
  return new Promise((resolve, reject) => {
    console.log("[CLIENT] Creating promise that will fail after suspending...")

    // First suspend for 2 seconds to show the fallback
    setTimeout(() => {
      console.log("[CLIENT] Promise is now rejecting with error!")
      reject(new Error("Data loading failed after suspending - this should be caught by error boundary"))
    }, 2000)
  })
}

// Cache to avoid creating multiple promises
let failingPromise: Promise<any> | null = null

export default function FailingComponent() {
  if (!failingPromise) {
    failingPromise = createFailingPromise()
  }

  try {
    // This will first suspend (showing fallback), then throw when promise rejects
    const data = use(failingPromise)

    // This should never execute because the promise rejects
    return (
      <div className="p-4 bg-green-100 border border-green-200 rounded">
        <h4 className="font-semibold text-green-800">✅ This should never appear!</h4>
        <p className="text-green-700 text-sm">Data: {JSON.stringify(data)}</p>
      </div>
    )
  } catch (error) {
    // In theory, this error should bubble up to the error boundary
    // But sometimes with Suspense, error boundaries don't catch properly
    console.error("[CLIENT] Error caught in component:", error)

    // Re-throw to let error boundary handle it
    throw error
  }
}
