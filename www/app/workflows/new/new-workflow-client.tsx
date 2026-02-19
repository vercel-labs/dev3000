"use client"

import { useRouter } from "next/navigation"
import { Suspense, useEffect, useState, useTransition } from "react"
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
  const [, startTransition] = useTransition()
  const [isClosing, setIsClosing] = useState(false)

  useEffect(() => {
    router.prefetch("/workflows")
  }, [router])

  const handleClose = () => {
    setIsClosing(true)
    startTransition(() => {
      router.push("/workflows")
    })
  }

  if (isClosing) return null

  return (
    <div>
      <Suspense fallback={<div>Loading...</div>}>
        <NewWorkflowModal isOpen={true} onClose={handleClose} userId={user.id} />
      </Suspense>
    </div>
  )
}
