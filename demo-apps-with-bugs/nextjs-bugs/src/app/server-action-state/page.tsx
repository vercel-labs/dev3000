import Link from "next/link"
import FormWithBuggyAction from "./form-with-buggy-action"
import RaceConditionForm from "./race-condition-form"
import StateUpdateForm from "./state-update-form"

export default function ServerActionStatePage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4">
        <div className="mb-8">
          <Link href="/" className="text-blue-600 hover:text-blue-800 font-medium">
            ← Back to Home
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8">
          <h1 className="text-3xl font-bold text-teal-600 mb-4">🔄 Server Actions + Client State</h1>

          <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 mb-6">
            <h2 className="text-lg font-semibold text-teal-800 mb-2">What's happening?</h2>
            <p className="text-teal-700 mb-4">
              This page demonstrates bugs in the interaction between Next.js server actions and client-side state
              management. These issues are particularly hard to debug because errors can occur on the server (in server
              actions), during network transmission, or in client-side state updates. You need consolidated logs to see
              the complete flow.
            </p>
          </div>

          <div className="space-y-8">
            {/* Server action with validation errors */}
            <div className="border border-gray-200 rounded-lg p-6">
              <h3 className="text-xl font-semibold text-gray-800 mb-3">❌ Server Action with Validation Errors</h3>
              <p className="text-gray-600 text-sm mb-4">
                This form calls a server action that randomly fails validation or throws errors. The client state
                management may not handle failures properly.
              </p>
              <FormWithBuggyAction />
            </div>

            {/* Client state update issues */}
            <div className="border border-gray-200 rounded-lg p-6">
              <h3 className="text-xl font-semibold text-gray-800 mb-3">🔄 Client State Update Issues</h3>
              <p className="text-gray-600 text-sm mb-4">
                Server action succeeds but client state updates fail or cause errors. The server thinks it worked, but
                the client state is inconsistent.
              </p>
              <StateUpdateForm />
            </div>

            {/* Race conditions between server actions */}
            <div className="border border-gray-200 rounded-lg p-6">
              <h3 className="text-xl font-semibold text-gray-800 mb-3">🏁 Race Conditions with Multiple Actions</h3>
              <p className="text-gray-600 text-sm mb-4">
                Multiple server actions or rapid form submissions can cause race conditions where client state gets out
                of sync with server state.
              </p>
              <RaceConditionForm />
            </div>
          </div>

          <div className="mt-8 p-4 bg-gray-100 rounded-lg">
            <h3 className="font-semibold text-gray-800 mb-2">Why dev3000's consolidated logs help:</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Track server action execution and validation on server side</li>
              <li>• See client-side form submission and error handling</li>
              <li>• Monitor network requests and responses for server actions</li>
              <li>• Observe client state updates after server action completion</li>
              <li>• Identify race conditions between multiple actions</li>
              <li>• Correlate server-side logs with client-side state changes</li>
              <li>• Debug timing issues between server and client</li>
            </ul>
          </div>

          <div className="mt-4 p-4 bg-teal-50 border border-teal-200 rounded-lg">
            <h3 className="font-semibold text-teal-800 mb-2">Expected Issues:</h3>
            <ul className="text-sm text-teal-700 space-y-1">
              <li>• Server action validation failures (server logs)</li>
              <li>• Network errors during form submission (client logs)</li>
              <li>• Client state update failures after successful server action</li>
              <li>• Race conditions causing inconsistent state</li>
              <li>• Form revalidation errors</li>
              <li>• CSRF or authentication issues</li>
            </ul>
          </div>

          <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <h3 className="font-semibold text-yellow-800 mb-2">💡 Debugging Tips:</h3>
            <p className="text-yellow-700 text-sm">
              Without consolidated logs, you'd need to check: server logs for action execution, browser network tab for
              HTTP requests, browser console for client errors, and React DevTools for state changes. dev3000 shows all
              of this in one timeline!
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
