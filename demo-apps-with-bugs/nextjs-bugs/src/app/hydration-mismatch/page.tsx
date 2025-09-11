"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

export default function HydrationMismatchPage() {
  const [currentTime, setCurrentTime] = useState<string>("")

  // This will cause a hydration mismatch because server and client
  // will have different timestamps
  useEffect(() => {
    setCurrentTime(new Date().toLocaleTimeString())
  }, [])

  // This is the problem: server renders empty string, client renders current time
  const serverTimeStamp = new Date().toLocaleTimeString()

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4">
        <div className="mb-8">
          <Link href="/" className="text-blue-600 hover:text-blue-800 font-medium">
            ← Back to Home
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8">
          <h1 className="text-3xl font-bold text-red-600 mb-4">💧 Hydration Mismatch Bug</h1>

          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <h2 className="text-lg font-semibold text-red-800 mb-2">What's happening?</h2>
            <p className="text-red-700 mb-4">
              This page intentionally creates a hydration mismatch error. The server renders one timestamp, but the
              client renders a different timestamp, causing React to detect the mismatch during hydration.
            </p>
          </div>

          {/* This will cause hydration mismatch */}
          <div className="space-y-4">
            <div className="p-4 bg-yellow-100 rounded-lg">
              <h3 className="font-semibold text-yellow-800">Server-rendered timestamp:</h3>
              <p className="text-yellow-700 font-mono">{serverTimeStamp}</p>
            </div>

            <div className="p-4 bg-blue-100 rounded-lg">
              <h3 className="font-semibold text-blue-800">Client-rendered timestamp:</h3>
              <p className="text-blue-700 font-mono">{currentTime}</p>
            </div>

            {/* Another hydration mismatch with random number */}
            <div className="p-4 bg-purple-100 rounded-lg">
              <h3 className="font-semibold text-purple-800">Random number (will mismatch):</h3>
              <p className="text-purple-700 font-mono">{Math.random()}</p>
            </div>
          </div>

          <div className="mt-8 p-4 bg-gray-100 rounded-lg">
            <h3 className="font-semibold text-gray-800 mb-2">Expected Errors:</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Hydration error in browser console</li>
              <li>• "Text content does not match server-rendered HTML" warning</li>
              <li>• React development warnings about hydration mismatch</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
