import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import NewWorkflowClient from "./new-workflow-client"

export default async function NewWorkflowPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect("/api/auth/authorize")
  }

  return <NewWorkflowClient user={user} />
}
