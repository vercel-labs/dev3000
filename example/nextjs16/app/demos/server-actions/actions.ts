"use server";

import { revalidatePath } from "next/cache";

interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: Date;
}

// In-memory storage (in production, use a database)
const todos: Todo[] = [];

export async function getTodos(): Promise<Todo[]> {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 100));
  return todos.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function addTodo(formData: FormData) {
  const text = formData.get("text") as string;

  if (!text || text.trim().length === 0) {
    return { error: "Todo text cannot be empty" };
  }

  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 300));

  const todo: Todo = {
    id: Math.random().toString(36).substring(7),
    text: text.trim(),
    completed: false,
    createdAt: new Date(),
  };

  todos.push(todo);
  revalidatePath("/demos/server-actions");

  return { success: true, todo };
}

export async function toggleTodo(id: string) {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 200));

  const todo = todos.find((t) => t.id === id);
  if (todo) {
    todo.completed = !todo.completed;
    revalidatePath("/demos/server-actions");
    return { success: true };
  }

  return { error: "Todo not found" };
}

export async function deleteTodo(id: string) {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 200));

  const index = todos.findIndex((t) => t.id === id);
  if (index !== -1) {
    todos.splice(index, 1);
    revalidatePath("/demos/server-actions");
    return { success: true };
  }

  return { error: "Todo not found" };
}

