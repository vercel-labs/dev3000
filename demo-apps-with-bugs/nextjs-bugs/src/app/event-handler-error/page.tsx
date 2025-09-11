"use client"

import Link from "next/link"
import { useState } from "react"

export default function EventHandlerErrorPage() {
  const [counter, setCounter] = useState(0)
  const [errorLog, setErrorLog] = useState<string[]>([])

  const handleBuggyClick = () => {
    // This will cause a reference error
    // @ts-expect-error - intentionally accessing undefined variable
    const result = undefinedVariable.someProperty
    console.log(result)
  }

  const handleTypeError = () => {
    // This will cause a type error
    const nullObject = null
    // @ts-expect-error - intentionally calling method on null
    nullObject.someMethod()
  }

  const handleDivisionByZero = () => {
    // This doesn't actually error in JavaScript but demonstrates bad logic
    const result = counter / 0
    console.log("Division result:", result) // Will log Infinity
    // But let's cause an actual error
    if (result === Infinity) {
      // @ts-expect-error - intentionally accessing property on undefined
      const errorVar = undefined.property
    }
  }

  const handleNestedError = () => {
    try {
      const obj = {
        nested: {
          deep: null
        }
      }
      // @ts-expect-error - intentionally accessing property on null
      const value = obj.nested.deep.veryDeep.property
    } catch (error) {
      // Re-throw to cause unhandled error
      throw new Error(`Nested error: ${error}`)
    }
  }

  const handleErrorWithCallback = () => {
    setTimeout(() => {
      // This error will be unhandled because it's in an async callback
      // @ts-expect-error
      nonExistentFunction()
    }, 100)
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
          <h1 className="text-3xl font-bold text-purple-600 mb-4">🎯 Event Handler Errors</h1>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
            <h2 className="text-lg font-semibold text-purple-800 mb-2">What's happening?</h2>
            <p className="text-purple-700 mb-4">
              This page contains various buttons that will trigger different types of JavaScript errors in event
              handlers. These errors will appear in the browser console and may break the user experience.
            </p>
          </div>

          <div className="mb-6">
            <div className="mb-4 p-4 bg-blue-100 rounded-lg">
              <h3 className="font-semibold text-blue-800">Counter: {counter}</h3>
              <button
                onClick={() => setCounter((c) => c + 1)}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 mt-2"
              >
                Safe Increment
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <button onClick={handleBuggyClick} className="bg-red-500 text-white px-4 py-3 rounded hover:bg-red-600">
                🐛 Reference Error
                <div className="text-xs mt-1">Accesses undefined variable</div>
              </button>

              <button
                onClick={handleTypeError}
                className="bg-orange-500 text-white px-4 py-3 rounded hover:bg-orange-600"
              >
                🚨 Type Error
                <div className="text-xs mt-1">Calls method on null</div>
              </button>

              <button
                onClick={handleDivisionByZero}
                className="bg-yellow-500 text-white px-4 py-3 rounded hover:bg-yellow-600"
              >
                ➗ Logic Error
                <div className="text-xs mt-1">Division by zero + property access</div>
              </button>

              <button
                onClick={handleNestedError}
                className="bg-pink-500 text-white px-4 py-3 rounded hover:bg-pink-600"
              >
                🔄 Nested Error
                <div className="text-xs mt-1">Caught and re-thrown error</div>
              </button>

              <button
                onClick={handleErrorWithCallback}
                className="bg-indigo-500 text-white px-4 py-3 rounded hover:bg-indigo-600"
              >
                ⏱️ Async Error
                <div className="text-xs mt-1">Error in setTimeout callback</div>
              </button>

              <button
                onClick={() => {
                  // Immediate error without try-catch
                  // @ts-expect-error
                  const broken = thisDoesNotExist.method()
                }}
                className="bg-gray-500 text-white px-4 py-3 rounded hover:bg-gray-600"
              >
                💥 Immediate Error
                <div className="text-xs mt-1">Direct undefined access</div>
              </button>
            </div>
          </div>

          <div className="mt-8 p-4 bg-gray-100 rounded-lg">
            <h3 className="font-semibold text-gray-800 mb-2">Expected Errors:</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• ReferenceError: undefinedVariable is not defined</li>
              <li>• TypeError: Cannot read properties of null</li>
              <li>• TypeError: Cannot read properties of undefined</li>
              <li>• Unhandled promise rejections</li>
              <li>• Stack traces in browser console</li>
            </ul>
          </div>

          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <h3 className="font-semibold text-red-800 mb-2">Pro Tip:</h3>
            <p className="text-red-700 text-sm">
              Open your browser's developer console (F12) before clicking these buttons to see the error messages and
              stack traces. dev3000 should capture these errors in its logs for AI analysis.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
