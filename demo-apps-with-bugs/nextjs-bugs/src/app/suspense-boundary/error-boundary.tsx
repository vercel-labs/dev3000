"use client"

import React from "react"

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class SuspenseErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    console.log("[ERROR BOUNDARY] Caught error:", error)
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ERROR BOUNDARY] Component stack:", errorInfo.componentStack)
    console.error("[ERROR BOUNDARY] Error details:", error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-red-100 border border-red-200 rounded-lg">
          <h4 className="font-semibold text-red-800 mb-2">❌ Error Boundary Activated</h4>
          <p className="text-red-700 text-sm mb-2">An error was caught by the error boundary:</p>
          <div className="bg-red-50 border border-red-200 rounded p-2 mb-2">
            <code className="text-red-800 text-xs">{this.state.error?.message || "Unknown error"}</code>
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="bg-red-600 text-white px-3 py-1 rounded text-xs hover:bg-red-700"
          >
            Try Again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

export default SuspenseErrorBoundary
