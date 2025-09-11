"use client"

import { use } from "react"

// Create a promise that resolves after a delay, or never resolves if delay is "infinite"
const createDelayedPromise = (delay: number | "infinite") => {
  if (delay === "infinite") {
    // This promise will never resolve, causing Suspense to hang forever
    return new Promise(() => {
      console.log("[CLIENT] Creating promise that will never resolve - Suspense will hang forever")
    })
  }

  return new Promise((resolve) => {
    console.log(`[CLIENT] Creating promise that will resolve in ${delay}ms`)
    setTimeout(() => {
      console.log(`[CLIENT] Promise resolved after ${delay}ms`)
      resolve(`Data loaded after ${delay}ms`)
    }, delay)
  })
}

// Global promise cache to avoid creating new promises on re-renders
const promiseCache = new Map<string, Promise<any>>()

interface SlowComponentProps {
  delay: number | "infinite"
}

export default function SlowComponent({ delay }: SlowComponentProps) {
  const cacheKey = `slow-${delay}`

  if (!promiseCache.has(cacheKey)) {
    promiseCache.set(cacheKey, createDelayedPromise(delay))
  }

  // This will suspend the component until the promise resolves
  const data = use(promiseCache.get(cacheKey)!)

  return (
    <div className="p-4 bg-green-100 border border-green-200 rounded">
      <h4 className="font-semibold text-green-800">✅ Slow Component Loaded!</h4>
      <p className="text-green-700 text-sm mt-1">{typeof data === "string" ? data : "Component loaded successfully"}</p>
      <p className="text-green-600 text-xs mt-1">Delay: {delay === "infinite" ? "∞ (never resolves)" : `${delay}ms`}</p>
    </div>
  )
}
