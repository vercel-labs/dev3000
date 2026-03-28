"use client"

import Link from "next/link"
import { useCallback, useRef, useState } from "react"
import useSWR from "swr"
import { ThemeToggle } from "@/components/theme-toggle"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { WorkflowRun } from "@/lib/workflow-storage"

interface UserInfo {
  id: string
  email: string
  name: string
  username: string
}

interface DevAgentRunsClientProps {
  user: UserInfo
  initialRuns: WorkflowRun[]
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const data = await res.json()
  if (!data.success) throw new Error(data.error)
  return data.runs as WorkflowRun[]
}

function formatDuration(start: Date, end: Date): string {
  const diffMs = end.getTime() - start.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const minutes = Math.floor(diffSec / 60)
  const seconds = diffSec % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function formatLegacyWorkflowType(type?: string): string {
  switch (type) {
    case "cls-fix":
      return "CLS Fix"
    case "prompt":
      return "Custom Prompt"
    case "design-guidelines":
      return "Design Guidelines Review"
    case "react-performance":
      return "React Performance Review"
    case "url-audit":
      return "URL Audit"
    case "turbopack-bundle-analyzer":
      return "Turbopack Bundle Analyzer"
    default:
      return "Dev Agent Run"
  }
}

function formatDevAgentLabel(run: WorkflowRun): string {
  return run.devAgentName || formatLegacyWorkflowType(run.type)
}

export default function DevAgentRunsClient({ user, initialRuns }: DevAgentRunsClientProps) {
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const lastSelectedIndex = useRef<number | null>(null)

  const { data: runs = initialRuns, mutate } = useSWR(`/api/workflows?userId=${user.id}`, fetcher, {
    fallbackData: initialRuns,
    refreshInterval: 5000,
    revalidateOnFocus: true
  })

  async function handleSignOut() {
    setIsSigningOut(true)
    try {
      await fetch("/api/auth/signout", { method: "POST" })
      const keysToRemove: string[] = []
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index)
        if (key?.startsWith("d3k_")) {
          keysToRemove.push(key)
        }
      }
      for (const key of keysToRemove) {
        localStorage.removeItem(key)
      }
      window.location.href = "/"
    } catch (error) {
      console.error("Failed to sign out:", error)
      setIsSigningOut(false)
    }
  }

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      setSelectedIds(checked ? new Set(runs.map((run) => run.id)) : new Set())
      lastSelectedIndex.current = null
    },
    [runs]
  )

  const handleSelectRow = useCallback(
    (runId: string, index: number, event: React.MouseEvent) => {
      setSelectedIds((current) => {
        const next = new Set(current)
        if (event.shiftKey && lastSelectedIndex.current !== null) {
          const start = Math.min(lastSelectedIndex.current, index)
          const end = Math.max(lastSelectedIndex.current, index)
          for (let itemIndex = start; itemIndex <= end; itemIndex++) {
            next.add(runs[itemIndex].id)
          }
        } else if (next.has(runId)) {
          next.delete(runId)
        } else {
          next.add(runId)
        }
        return next
      })
      lastSelectedIndex.current = index
    },
    [runs]
  )

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const response = await fetch("/api/workflows", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          userId: user.id,
          runIds: Array.from(selectedIds)
        })
      })
      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || "Failed to delete runs.")
      }

      await mutate()
      setSelectedIds(new Set())
      setIsDeleteDialogOpen(false)
    } catch (error) {
      console.error("Failed to delete runs:", error)
      alert(error instanceof Error ? error.message : "Failed to delete runs.")
    } finally {
      setIsDeleting(false)
    }
  }

  const allSelected = runs.length > 0 && selectedIds.size === runs.length
  const someSelected = selectedIds.size > 0 && selectedIds.size < runs.length

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-8 pt-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-foreground">
              <Link href="/dev-agents" className="hover:opacity-80 transition-opacity">
                Dev Agents
              </Link>
              <span> - Runs</span>
            </h1>
            <p className="text-muted-foreground">View all of your dev-agent analyses, fixes, and PR-ready runs.</p>
            <p className="text-sm text-muted-foreground">Signed in as {user.email}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            {selectedIds.size > 0 && (
              <Button variant="destructive" onClick={() => setIsDeleteDialogOpen(true)}>
                Delete {selectedIds.size} selected
              </Button>
            )}
            <Button asChild>
              <Link href="/dev-agents/new">Create Dev Agent</Link>
            </Button>
            <ThemeToggle />
            <Button variant="outline" onClick={handleSignOut} disabled={isSigningOut}>
              {isSigningOut ? "Signing out..." : "Sign out"}
            </Button>
          </div>
        </div>

        {runs.length === 0 ? (
          <Card className="p-12 text-center">
            <CardContent>
              <p className="text-muted-foreground">No dev agent runs yet.</p>
              <p className="mt-2 text-sm text-muted-foreground/70">Choose a dev agent and run it against a project.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={(checked) => handleSelectAll(checked === true)}
                      aria-label="Select all runs"
                    />
                  </TableHead>
                  <TableHead>Dev Agent</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Mode</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run, index) => {
                  const createdAt = new Date(run.timestamp)
                  const completedAt = run.completedAt ? new Date(run.completedAt) : null
                  const duration = completedAt ? formatDuration(createdAt, completedAt) : "Running"

                  return (
                    <TableRow key={run.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(run.id)}
                          onCheckedChange={() =>
                            handleSelectRow(run.id, index, { shiftKey: false } as React.MouseEvent)
                          }
                          onClick={(event) => handleSelectRow(run.id, index, event as unknown as React.MouseEvent)}
                          aria-label={`Select ${run.projectName}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Link
                            href={`/dev-agents/runs/${run.id}/report`}
                            className="font-medium text-primary hover:underline"
                          >
                            {formatDevAgentLabel(run)}
                          </Link>
                          {run.devAgentExecutionMode && (
                            <div className="text-xs text-muted-foreground">
                              {run.devAgentExecutionMode === "dev-server" ? "Dev Server" : "Preview + PR"}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{run.projectName}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            run.status === "done" ? "default" : run.status === "failure" ? "destructive" : "secondary"
                          }
                        >
                          {run.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{createdAt.toLocaleString()}</TableCell>
                      <TableCell>{duration}</TableCell>
                      <TableCell>
                        {run.devAgentExecutionMode === "preview-pr" ? "Preview + PR" : "Dev Server"}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete dev agent runs?</DialogTitle>
            <DialogDescription>
              This removes the selected run metadata and any attached blobs, including screenshots and reports.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isDeleting}>
                Cancel
              </Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? "Deleting..." : "Delete Runs"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
