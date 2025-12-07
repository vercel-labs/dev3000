"use client"

import Link from "next/link"
import { useCallback, useRef, useState } from "react"
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

interface WorkflowsClientProps {
  user: UserInfo
  initialRuns: WorkflowRun[]
}

export default function WorkflowsClient({ user, initialRuns }: WorkflowsClientProps) {
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [runs, setRuns] = useState<WorkflowRun[]>(initialRuns)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const lastSelectedIndex = useRef<number | null>(null)

  async function handleSignOut() {
    setIsSigningOut(true)
    try {
      await fetch("/api/auth/signout", { method: "POST" })
      window.location.href = "/"
    } catch (error) {
      console.error("Failed to sign out:", error)
      setIsSigningOut(false)
    }
  }

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedIds(new Set(runs.map((run) => run.id)))
      } else {
        setSelectedIds(new Set())
      }
      lastSelectedIndex.current = null
    },
    [runs]
  )

  const handleSelectRow = useCallback(
    (runId: string, index: number, event: React.MouseEvent) => {
      setSelectedIds((prev) => {
        const newSelected = new Set(prev)

        // Handle shift-click for range selection
        if (event.shiftKey && lastSelectedIndex.current !== null) {
          const start = Math.min(lastSelectedIndex.current, index)
          const end = Math.max(lastSelectedIndex.current, index)

          // Select all items in the range
          for (let i = start; i <= end; i++) {
            newSelected.add(runs[i].id)
          }
        } else {
          // Regular click - toggle selection
          if (newSelected.has(runId)) {
            newSelected.delete(runId)
          } else {
            newSelected.add(runId)
          }
        }

        return newSelected
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

      if (result.success) {
        // Remove deleted runs from state
        setRuns((prev) => prev.filter((run) => !selectedIds.has(run.id)))
        setSelectedIds(new Set())
        setIsDeleteDialogOpen(false)
      } else {
        console.error("Failed to delete workflows:", result.error)
        alert(`Failed to delete workflows: ${result.error}`)
      }
    } catch (error) {
      console.error("Failed to delete workflows:", error)
      alert("Failed to delete workflows. Please try again.")
    } finally {
      setIsDeleting(false)
    }
  }

  const allSelected = runs.length > 0 && selectedIds.size === runs.length
  const someSelected = selectedIds.size > 0 && selectedIds.size < runs.length

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <div className="flex-shrink-0 px-4 sm:px-6 lg:px-8 pt-8 pb-4 max-w-7xl mx-auto w-full">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">d3k Workflow Runs</h1>
            <p className="mt-2 text-gray-600">View all your d3k workflow fix proposals and PRs</p>
            <p className="mt-1 text-sm text-gray-500">Signed in as {user.email}</p>
          </div>
          <div className="flex gap-3">
            {selectedIds.size > 0 && (
              <Button variant="destructive" onClick={() => setIsDeleteDialogOpen(true)}>
                Delete {selectedIds.size} selected
              </Button>
            )}
            <Button asChild>
              <Link href="/workflows/new">New Workflow</Link>
            </Button>
            <Button variant="outline" onClick={handleSignOut} disabled={isSigningOut}>
              {isSigningOut ? "Signing out..." : "Sign out"}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 px-4 sm:px-6 lg:px-8 pb-8 max-w-7xl mx-auto w-full">
        {runs.length === 0 ? (
          <Card className="p-12 text-center">
            <CardContent>
              <p className="text-muted-foreground">No workflow runs yet</p>
              <p className="text-sm text-muted-foreground/70 mt-2">Run a workflow from the CLI to see it appear here</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="h-full flex flex-col overflow-hidden">
            <div className="overflow-auto flex-1 [&_[data-slot=table-container]]:overflow-visible">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10 shadow-[0_1px_3px_-1px_rgba(0,0,0,0.1)]">
                  <TableRow>
                    <TableHead className="w-8 pr-0">
                      <Checkbox
                        checked={allSelected}
                        ref={(el) => {
                          if (el) {
                            // Set indeterminate state for "some selected"
                            const input = el.querySelector("button") as HTMLButtonElement
                            if (input) {
                              input.dataset.state = someSelected
                                ? "indeterminate"
                                : allSelected
                                  ? "checked"
                                  : "unchecked"
                            }
                          }
                        }}
                        onCheckedChange={handleSelectAll}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>Project ({runs.length})</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Report</TableHead>
                    <TableHead>PR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run, index) => (
                    <TableRow
                      key={`${run.id}-${run.timestamp}`}
                      className={selectedIds.has(run.id) ? "bg-muted/50" : undefined}
                    >
                      <TableCell className="pr-0">
                        <Checkbox
                          checked={selectedIds.has(run.id)}
                          onClick={(e) => handleSelectRow(run.id, index, e)}
                          onCheckedChange={() => {}}
                          aria-label={`Select ${run.projectName}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{run.projectName}</div>
                        <div className="text-xs text-muted-foreground">{run.id}</div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            run.status === "done" ? "secondary" : run.status === "running" ? "default" : "destructive"
                          }
                          className={
                            run.status === "done"
                              ? "bg-green-100 text-green-800 hover:bg-green-100"
                              : run.status === "running"
                                ? "bg-blue-100 text-blue-800 hover:bg-blue-100"
                                : ""
                          }
                        >
                          {run.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(run.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {run.reportBlobUrl ? (
                          <Link href={`/workflows/${run.id}/report`} className="text-primary hover:underline">
                            View Report
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">No report</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {run.prUrl ? (
                          <a
                            href={run.prUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            View PR
                          </a>
                        ) : (
                          <span className="text-muted-foreground">No PR</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </div>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Workflow Runs</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {selectedIds.size} workflow run{selectedIds.size === 1 ? "" : "s"}? This
              will permanently delete all associated data including screenshots and reports. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isDeleting}>
                Cancel
              </Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? "Deleting..." : `Delete ${selectedIds.size} run${selectedIds.size === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
