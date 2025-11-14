"use client"

import { useRouter } from "next/navigation"
import { Suspense } from "react"
import NewWorkflowModal from "../new-workflow-modal"

interface UserInfo {
  id: string
  email: string
  name: string
  username: string
}

interface NewWorkflowClientProps {
  user: UserInfo
}

export default function NewWorkflowClient({ user }: NewWorkflowClientProps) {
  const router = useRouter()

  const handleClose = () => {
    router.push("/workflows")
  }

  return (
    <div>
      <Suspense fallback={<div>Loading...</div>}>
        <NewWorkflowModal isOpen={true} onClose={handleClose} userId={user.id} />
      </Suspense>
    </div>
  )
}
