"use client";

import Link from "next/link";
import { useState } from "react";

export default function CounterDemo() {
  const [count, setCount] = useState(0);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-black to-gray-900">
      <div className="container mx-auto px-4 py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 mb-8 transition-colors"
        >
          ← Back to Home
        </Link>

        <div className="max-w-2xl mx-auto">
          <h1 className="text-4xl font-bold text-white mb-4">Counter Demo</h1>
          <p className="text-gray-400 mb-8">
            Interactive client-side state management with React 19 and Next.js 16
          </p>

          <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-12 backdrop-blur-sm">
            <div className="text-center mb-8">
              <div className="text-8xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent mb-4">
                {count}
              </div>
              <p className="text-gray-400">Current Count</p>
            </div>

            <div className="flex gap-4 justify-center flex-wrap">
              <button
                type="button"
                onClick={() => setCount(count - 1)}
                className="px-8 py-4 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 rounded-lg font-semibold transition-all duration-300 hover:scale-105"
              >
                Decrement
              </button>
              <button
                type="button"
                onClick={() => setCount(0)}
                className="px-8 py-4 bg-gray-500/20 hover:bg-gray-500/30 border border-gray-500/50 text-gray-400 rounded-lg font-semibold transition-all duration-300 hover:scale-105"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setCount(count + 1)}
                className="px-8 py-4 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 text-cyan-400 rounded-lg font-semibold transition-all duration-300 hover:scale-105"
              >
                Increment
              </button>
            </div>

            <div className="mt-8 pt-8 border-t border-gray-700">
              <h3 className="text-white font-semibold mb-4">Quick Actions</h3>
              <div className="flex gap-2 flex-wrap justify-center">
                <button
                  type="button"
                  onClick={() => setCount(count + 10)}
                  className="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded text-sm transition-all"
                >
                  +10
                </button>
                <button
                  type="button"
                  onClick={() => setCount(count + 100)}
                  className="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded text-sm transition-all"
                >
                  +100
                </button>
                <button
                  type="button"
                  onClick={() => setCount(count - 10)}
                  className="px-4 py-2 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 text-orange-400 rounded text-sm transition-all"
                >
                  -10
                </button>
                <button
                  type="button"
                  onClick={() => setCount(count - 100)}
                  className="px-4 py-2 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 text-orange-400 rounded text-sm transition-all"
                >
                  -100
                </button>
                <button
                  type="button"
                  onClick={() => setCount(count * 2)}
                  className="px-4 py-2 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-400 rounded text-sm transition-all"
                >
                  ×2
                </button>
                <button
                  type="button"
                  onClick={() => setCount(Math.floor(count / 2))}
                  className="px-4 py-2 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-400 rounded text-sm transition-all"
                >
                  ÷2
                </button>
              </div>
            </div>
          </div>

          <div className="mt-8 bg-gray-800/30 border border-gray-700 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-3">Features Demonstrated</h3>
            <ul className="space-y-2 text-gray-400">
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">✓</span>
                <span>Client-side state management with React 19 useState hook</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">✓</span>
                <span>Interactive UI updates without page refresh</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">✓</span>
                <span>Tailwind CSS for modern styling and animations</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">✓</span>
                <span>"use client" directive for client components in App Router</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

