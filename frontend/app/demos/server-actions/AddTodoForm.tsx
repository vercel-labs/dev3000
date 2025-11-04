"use client";

import { useFormStatus } from "react-dom";
import { addTodo } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 disabled:from-gray-500 disabled:to-gray-600 text-white font-semibold rounded-lg transition-all duration-300 disabled:cursor-not-allowed"
    >
      {pending ? "Adding..." : "Add Todo"}
    </button>
  );
}

export default function AddTodoForm() {
  async function handleSubmit(formData: FormData) {
    const result = await addTodo(formData);
    if (result.error) {
      alert(result.error);
    } else {
      // Reset form
      const form = document.getElementById("add-todo-form") as HTMLFormElement;
      form?.reset();
    }
  }

  return (
    <form id="add-todo-form" action={handleSubmit} className="flex gap-4">
      <input
        type="text"
        name="text"
        placeholder="Enter a new todo..."
        className="flex-1 px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 transition-colors"
        required
      />
      <SubmitButton />
    </form>
  );
}

