import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const wwwRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const reportBlobSource = readFileSync(path.join(wwwRoot, "lib/workflow-report-blob.ts"), "utf8")
const reportBlobRouteSource = readFileSync(path.join(wwwRoot, "app/api/internal/report-blobs/route.ts"), "utf8")

describe("workflow report blob mirroring source", () => {
  it("mirrors report blobs with the same bearer-token fallback used by run metadata", () => {
    expect(reportBlobSource).toContain("headers.authorization = `Bearer ")
    expect(reportBlobSource).toContain("accessToken}`")
    expect(reportBlobSource).toContain('JSON.stringify({ pathname, content, contentType: "application/json", userId })')
  })

  it("requires bearer-token report uploads to match the mirrored owner user", () => {
    expect(reportBlobRouteSource).toContain("getCurrentUserFromRequest(request)")
    expect(reportBlobRouteSource).toContain("body.userId !== user.id")
    expect(reportBlobRouteSource).toContain("Report blob user mismatch")
  })
})
