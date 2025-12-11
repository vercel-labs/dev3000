import Link from "next/link"

export default function AuthErrorPage({
  searchParams
}: {
  searchParams: { error?: string; error_description?: string }
}) {
  const error = searchParams.error || "unknown_error"
  const description = searchParams.error_description || "An unknown error occurred during authentication"

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-8 rounded-lg bg-white p-8 shadow-md">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 text-red-600">
            <svg className="h-full w-full" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-gray-900">Authentication Error</h1>
          <p className="mt-2 text-sm text-gray-600">Error: {error}</p>
          <p className="mt-1 text-sm text-gray-500">{decodeURIComponent(description)}</p>
        </div>

        <div className="mt-8 space-y-4">
          <Link
            href="/signin"
            className="flex w-full justify-center rounded-md bg-black px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            Try Again
          </Link>
          <Link
            href="/"
            className="flex w-full justify-center rounded-md border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Go Home
          </Link>
        </div>
      </div>
    </div>
  )
}
