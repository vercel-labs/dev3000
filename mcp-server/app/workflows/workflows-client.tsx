"use client"

import Link from "next/link"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">d3k Workflow Runs</h1>
            <p className="mt-2 text-gray-600">View all your d3k workflow fix proposals and PRs</p>
            <p className="mt-1 text-sm text-gray-500">Signed in as {user.email}</p>
          </div>
          <div className="flex gap-3">
            <Button asChild>
              <Link href="/workflows/new">New Workflow</Link>
            </Button>
            <Button variant="outline" onClick={handleSignOut} disabled={isSigningOut}>
              {isSigningOut ? "Signing out..." : "Sign out"}
            </Button>
          </div>
        </div>

        {initialRuns.length === 0 ? (
          <Card className="p-12 text-center">
            <CardContent>
              <p className="text-muted-foreground">No workflow runs yet</p>
              <p className="text-sm text-muted-foreground/70 mt-2">Run a workflow from the CLI to see it appear here</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Report</TableHead>
                  <TableHead>PR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialRuns.map((run) => (
                  <TableRow key={`${run.id}-${run.timestamp}`}>
                    <TableCell>
                      <div className="font-medium">{run.projectName}</div>
                      <div className="text-xs text-muted-foreground">{run.id}</div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          run.status === "success" ? "secondary" : run.status === "running" ? "default" : "destructive"
                        }
                        className={
                          run.status === "success"
                            ? "bg-green-100 text-green-800 hover:bg-green-100"
                            : run.status === "running"
                              ? "bg-blue-100 text-blue-800 hover:bg-blue-100"
                              : ""
                        }
                      >
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{new Date(run.timestamp).toLocaleString()}</TableCell>
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
          </Card>
        )}
      </div>
    </div>
  )
}
