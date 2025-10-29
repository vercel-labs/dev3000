"use client";

import { useOptimistic, useState } from "react";
import { deleteTodo, toggleTodo } from "./actions";

interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: Date;
}

export default function TodoList({ initialTodos }: { initialTodos: Todo[] }) {
  const [todos, setTodos] = useState(initialTodos);
  const [optimisticTodos, addOptimisticTodo] = useOptimistic(
    todos,
    (state, newTodo: Todo | { id: string; action: "toggle" | "delete" }) => {
      if ("action" in newTodo) {
        if (newTodo.action === "delete") {
          return state.filter((t) => t.id !== newTodo.id);
        }
        return state.map((t) => (t.id === newTodo.id ? { ...t, completed: !t.completed } : t));
      }
      return [...state, newTodo];
    }
  );

  async function handleToggle(id: string) {
    addOptimisticTodo({ id, action: "toggle" });
    await toggleTodo(id);
  }

  async function handleDelete(id: string) {
    addOptimisticTodo({ id, action: "delete" });
    await deleteTodo(id);
  }

  if (optimisticTodos.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No todos yet. Add one above to get started!
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {optimisticTodos.map((todo) => (
        <div
          key={todo.id}
          className="flex items-center gap-4 p-4 bg-gray-900/30 border border-gray-700 rounded-lg group hover:border-gray-600 transition-colors"
        >
          <button
            type="button"
            onClick={() => handleToggle(todo.id)}
            className={`flex-shrink-0 w-6 h-6 rounded border-2 transition-all ${
              todo.completed
                ? "bg-cyan-500 border-cyan-500"
                : "border-gray-600 hover:border-cyan-500"
            }`}
          >
            {todo.completed && (
              <svg
                className="w-full h-full text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-label="Completed checkmark"
                role="img"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={3}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
          </button>

          <span
            className={`flex-1 ${todo.completed ? "line-through text-gray-500" : "text-white"}`}
          >
            {todo.text}
          </span>

          <button
            type="button"
            onClick={() => handleDelete(todo.id)}
            className="opacity-0 group-hover:opacity-100 px-3 py-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-all"
          >
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}

