"use client"

import { Suspense, use } from "react"

// Different promises with different timing
const createPromise = (name: string, delay: number) => {
  return new Promise((resolve) => {
    console.log(`[CLIENT] Creating promise for ${name} with ${delay}ms delay`)
    setTimeout(() => {
      console.log(`[CLIENT] ${name} promise resolved after ${delay}ms`)
      resolve(`${name} data loaded`)
    }, delay)
  })
}

// Promise cache
const promiseCache = new Map<string, Promise<any>>()

function FastInnerComponent() {
  const key = "fast-inner"
  if (!promiseCache.has(key)) {
    promiseCache.set(key, createPromise("Fast Inner", 500))
  }

  const data = use(promiseCache.get(key)!)

  return (
    <div className="ml-4 p-3 bg-blue-100 border border-blue-200 rounded">
      <h5 className="font-medium text-blue-800">🏃‍♂️ Fast Inner Component</h5>
      <p className="text-blue-700 text-sm">{data}</p>
    </div>
  )
}

function SlowInnerComponent() {
  const key = "slow-inner"
  if (!promiseCache.has(key)) {
    promiseCache.set(key, createPromise("Slow Inner", 3000))
  }

  const data = use(promiseCache.get(key)!)

  return (
    <div className="ml-4 p-3 bg-orange-100 border border-orange-200 rounded">
      <h5 className="font-medium text-orange-800">🐌 Slow Inner Component</h5>
      <p className="text-orange-700 text-sm">{data}</p>
    </div>
  )
}

function MiddleComponent() {
  const key = "middle"
  if (!promiseCache.has(key)) {
    promiseCache.set(key, createPromise("Middle", 1000))
  }

  const data = use(promiseCache.get(key)!)

  return (
    <div className="p-3 bg-purple-100 border border-purple-200 rounded">
      <h4 className="font-medium text-purple-800">🎯 Middle Component</h4>
      <p className="text-purple-700 text-sm mb-3">{data}</p>

      <div className="space-y-3">
        {/* Nested Suspense boundaries with different timing */}
        <Suspense
          fallback={
            <div className="ml-4 p-2 bg-blue-50 border border-blue-100 rounded animate-pulse">
              <p className="text-blue-600 text-xs">⏳ Loading fast component...</p>
            </div>
          }
        >
          <FastInnerComponent />
        </Suspense>

        <Suspense
          fallback={
            <div className="ml-4 p-2 bg-orange-50 border border-orange-100 rounded animate-pulse">
              <p className="text-orange-600 text-xs">⏳ Loading slow component...</p>
            </div>
          }
        >
          <SlowInnerComponent />
        </Suspense>

        {/* This creates a race condition - the outer boundary might resolve 
            before inner boundaries, causing layout shifts and hydration issues */}
        <div className="ml-4 p-3 bg-red-100 border border-red-200 rounded">
          <h5 className="font-medium text-red-800">⚠️ Race Condition Alert</h5>
          <p className="text-red-700 text-sm">
            The nested Suspense boundaries above have different timing, which can cause:
          </p>
          <ul className="text-red-600 text-xs mt-1 ml-4 list-disc">
            <li>Layout shifts as components load at different times</li>
            <li>Hydration mismatches between server and client</li>
            <li>Inconsistent loading states</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default function NestedSuspenseComponent() {
  return (
    <div className="space-y-4">
      <Suspense
        fallback={
          <div className="p-3 bg-purple-50 border border-purple-100 rounded animate-pulse">
            <p className="text-purple-600 text-sm">⏳ Loading middle component...</p>
          </div>
        }
      >
        <MiddleComponent />
      </Suspense>

      <div className="p-4 bg-gray-100 rounded-lg">
        <h4 className="font-medium text-gray-800 mb-2">🔍 What to watch for:</h4>
        <ul className="text-gray-600 text-sm space-y-1">
          <li>• Different components resolving at different times</li>
          <li>• Potential layout shifts as nested boundaries resolve</li>
          <li>• Server vs client timing differences</li>
          <li>• Console logs showing the loading sequence</li>
        </ul>
      </div>
    </div>
  )
}
