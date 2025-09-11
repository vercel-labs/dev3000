"use server"

import { revalidatePath } from "next/cache"

// Server action that randomly fails validation
export async function buggyFormAction(formData: FormData) {
  const name = formData.get("name") as string
  const email = formData.get("email") as string

  console.log("[SERVER ACTION] buggyFormAction called with:", { name, email })

  // Simulate processing delay
  await new Promise((resolve) => setTimeout(resolve, 1000))

  // Random validation failures
  const random = Math.random()

  if (random < 0.3) {
    console.log("[SERVER ACTION] Validation failed - name too short")
    throw new Error("Validation failed: Name must be at least 3 characters")
  }

  if (random < 0.5) {
    console.log("[SERVER ACTION] Server error occurred")
    throw new Error("Internal server error: Database connection failed")
  }

  if (random < 0.7) {
    console.log("[SERVER ACTION] Email validation failed")
    return {
      success: false,
      error: "Invalid email format - please use a valid email address"
    }
  }

  console.log("[SERVER ACTION] Success! Data saved:", { name, email })
  return {
    success: true,
    message: `User ${name} created successfully!`,
    data: { name, email, id: Math.floor(Math.random() * 1000) }
  }
}

// Server action that succeeds but client state updates will fail
export async function stateUpdateAction(formData: FormData) {
  const title = formData.get("title") as string
  const description = formData.get("description") as string

  console.log("[SERVER ACTION] stateUpdateAction called with:", { title, description })

  await new Promise((resolve) => setTimeout(resolve, 800))

  // This will always succeed on server
  console.log("[SERVER ACTION] Task created successfully:", { title, description })
  return {
    success: true,
    task: {
      id: Math.floor(Math.random() * 1000),
      title,
      description,
      createdAt: new Date().toISOString(),
      status: "pending"
    }
  }
}

// Server action for race condition testing
export async function raceConditionAction(formData: FormData) {
  const counter = formData.get("counter") as string
  const actionId = Math.random().toString(36).substring(7)

  console.log(`[SERVER ACTION ${actionId}] raceConditionAction called with counter:`, counter)

  // Variable delay to create race conditions
  const delay = Math.random() * 2000 + 500 // 500ms to 2.5s
  await new Promise((resolve) => setTimeout(resolve, delay))

  const newCounter = parseInt(counter) + 1

  console.log(`[SERVER ACTION ${actionId}] Completed after ${delay.toFixed(0)}ms, returning counter:`, newCounter)

  return {
    success: true,
    counter: newCounter,
    actionId,
    processedAt: new Date().toISOString()
  }
}

// Server action that simulates database conflicts
export async function conflictAction(formData: FormData) {
  const version = formData.get("version") as string
  const data = formData.get("data") as string

  console.log("[SERVER ACTION] conflictAction called with version:", version, "data:", data)

  await new Promise((resolve) => setTimeout(resolve, 1000))

  // Simulate version conflicts
  const currentVersion = Math.floor(Date.now() / 10000) // Changes every 10 seconds

  if (parseInt(version) !== currentVersion) {
    console.log("[SERVER ACTION] Version conflict detected:", { provided: version, current: currentVersion })
    return {
      success: false,
      error: "Version conflict: Data was modified by another process",
      currentVersion
    }
  }

  console.log("[SERVER ACTION] Data updated successfully")
  return {
    success: true,
    message: "Data updated successfully",
    newVersion: currentVersion + 1
  }
}
