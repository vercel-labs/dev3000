import Link from "next/link";
import AddTodoForm from "./AddTodoForm";
import TodoList from "./TodoList";
import { getTodos } from "./actions";

export default async function ServerActionsDemo() {
  const todos = await getTodos();

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-black to-gray-900">
      <div className="container mx-auto px-4 py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 mb-8 transition-colors"
        >
          ← Back to Home
        </Link>

        <div className="max-w-3xl mx-auto">
          <h1 className="text-4xl font-bold text-white mb-4">Server Actions Demo</h1>
          <p className="text-gray-400 mb-8">
            Experience Next.js 16 Server Actions with real-time updates and optimistic UI
          </p>

          <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-8 backdrop-blur-sm mb-8">
            <h2 className="text-2xl font-bold text-white mb-6">Todo List</h2>

            <AddTodoForm />

            <div className="mt-8">
              <TodoList initialTodos={todos} />
            </div>
          </div>

          <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-3">Features Demonstrated</h3>
            <ul className="space-y-2 text-gray-400">
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">✓</span>
                <span>Server Actions with "use server" directive</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">✓</span>
                <span>Automatic revalidation with revalidatePath()</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">✓</span>
                <span>Progressive enhancement with forms</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">✓</span>
                <span>Server-side data mutations without API routes</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">✓</span>
                <span>Optimistic UI updates for better UX</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">✓</span>
                <span>Type-safe server-client communication</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

