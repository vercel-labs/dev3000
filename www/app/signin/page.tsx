import Link from "next/link"
import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"

export default async function SignInPage() {
  const user = await getCurrentUser()

  // If already signed in, redirect to workflows
  if (user) {
    redirect("/workflows")
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-8 rounded-lg bg-white p-8 shadow-md">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Sign in to dev3000</h1>
          <p className="mt-2 text-sm text-gray-600">Access your workflows and projects</p>
        </div>

        <div className="mt-8">
          <Link
            href="/api/auth/authorize"
            prefetch={false}
            className="flex w-full justify-center rounded-md bg-black px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            Sign in with Vercel
          </Link>
          <p className="mt-3 text-center text-xs text-amber-700">Currently only works for Vercelians.</p>
        </div>

        <p className="mt-4 text-center text-xs text-gray-500">
          By signing in, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  )
}
