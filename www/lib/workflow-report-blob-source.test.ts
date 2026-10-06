import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { GET as getBlob } from "@/app/api/blob/route"
import { POST as postReportBlob } from "@/app/api/internal/report-blobs/route"

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

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getCurrentUserFromRequest: vi.fn(),
  getWorkflowMirrorSecret: vi.fn(),
  get: vi.fn(),
  put: vi.fn()
}))

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  getCurrentUserFromRequest: mocks.getCurrentUserFromRequest
}))
vi.mock("@/lib/workflow-storage", () => ({ getWorkflowMirrorSecret: mocks.getWorkflowMirrorSecret }))
vi.mock("@vercel/blob", () => ({ get: mocks.get, put: mocks.put, del: vi.fn() }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getCurrentUser.mockResolvedValue(null)
  mocks.getCurrentUserFromRequest.mockResolvedValue({ id: "attacker" })
  mocks.getWorkflowMirrorSecret.mockReturnValue(null)
  mocks.put.mockResolvedValue({ pathname: "report-test.json" })
})

function storedBlob(contentType: string | undefined, body = "untrusted content") {
  mocks.get.mockResolvedValue({
    statusCode: 200,
    blob: { contentType, contentDisposition: 'inline; filename="report-test.svg"' },
    stream: new Response(body).body
  })
}

function blobRequest(pathname = "report-test.svg") {
  return new Request(`https://dev3000.test/api/blob?pathname=${encodeURIComponent(pathname)}`)
}

function reportRequest(payload: Record<string, unknown> = {}, headers: HeadersInit = {}) {
  const requestHeaders = new Headers(headers)
  requestHeaders.set("content-type", "application/json")
  return new Request("https://dev3000.test/api/internal/report-blobs", {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({ pathname: "report-test.json", content: '{"ok":true}', userId: "attacker", ...payload })
  })
}

function expectRestrictedHeaders(response: Response) {
  expect(response.headers.get("x-content-type-options")).toBe("nosniff")
  expect(response.headers.get("content-security-policy")).toBe(
    "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'"
  )
}

describe("blob proxy response isolation", () => {
  it.each([
    "image/svg+xml",
    "image/svg+xml; charset=utf-8",
    "text/html",
    "application/xhtml+xml",
    "text/xml",
    "application/xml",
    "application/pdf",
    "image/unknown",
    "application/gzip",
    undefined
  ])("downloads existing %s blobs instead of rendering them on the app origin", async (contentType) => {
    const payload = '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/api/auth/token")</script></svg>'
    storedBlob(contentType, payload)
    const response = await getBlob(blobRequest())

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/octet-stream")
    expect(response.headers.get("content-disposition")).toBe("attachment")
    expectRestrictedHeaders(response)
    expect(await response.text()).toBe(payload)
    expect(mocks.getCurrentUser).not.toHaveBeenCalled()
    expect(mocks.get).toHaveBeenCalledWith("report-test.svg", { access: "private", useCache: false })
  })

  it.each(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"])(
    "keeps %s screenshots embeddable with restricted headers",
    async (contentType) => {
      storedBlob(contentType)
      const response = await getBlob(blobRequest("workflow-test.png"))
      expect(response.headers.get("content-type")).toBe(contentType)
      expect(response.headers.get("content-disposition")).toBe("inline")
      expectRestrictedHeaders(response)
    }
  )

  it("preserves fetch-based JSON readers despite the download headers", async () => {
    storedBlob("application/json", '{"ok":true}')
    const response = await getBlob(blobRequest("report-test.json"))
    expect(response.headers.get("content-type")).toBe("application/octet-stream")
    expect(await response.json()).toEqual({ ok: true })
  })

  it("retains authentication on private blobs", async () => {
    const response = await getBlob(blobRequest("private-test.svg"))
    expect(response.status).toBe(401)
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it("also restricts private blobs for authenticated readers", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "victim" })
    storedBlob("image/svg+xml")
    const response = await getBlob(blobRequest("private-test.svg"))
    expect(response.status).toBe(200)
    expect(response.headers.get("content-disposition")).toBe("attachment")
    expectRestrictedHeaders(response)
  })

  it.each(["https://example.invalid/payload.svg", "http://example.invalid/payload.svg"])(
    "still rejects absolute blob URLs: %s",
    async (pathname) => {
      expect((await getBlob(blobRequest(pathname))).status).toBe(400)
      expect(mocks.get).not.toHaveBeenCalled()
    }
  )

  it("retains missing-blob handling", async () => {
    mocks.get.mockResolvedValue(null)
    expect((await getBlob(blobRequest())).status).toBe(404)
  })
})

describe("report blob uploads", () => {
  it.each([undefined, "application/json"])("accepts JSON reports with contentType %s", async (contentType) => {
    const response = await postReportBlob(reportRequest({ contentType }))
    expect(response.status).toBe(200)
    expect(mocks.put).toHaveBeenCalledWith("report-test.json", '{"ok":true}', {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true
    })
  })

  it.each(["image/svg+xml", "text/html", "text/xml", "image/png", "", null])(
    "rejects a user-selected contentType of %s before storage",
    async (contentType) => {
      expect((await postReportBlob(reportRequest({ contentType }))).status).toBe(400)
      expect(mocks.put).not.toHaveBeenCalled()
    }
  )

  it.each([undefined, "application/json"])("rejects markup disguised as %s", async (contentType) => {
    const response = await postReportBlob(reportRequest({ contentType, content: "<svg><script/></svg>" }))
    expect(response.status).toBe(400)
    expect(mocks.put).not.toHaveBeenCalled()
  })

  it("still requires authentication", async () => {
    mocks.getCurrentUserFromRequest.mockResolvedValue(null)
    expect((await postReportBlob(reportRequest())).status).toBe(401)
    expect(mocks.put).not.toHaveBeenCalled()
  })

  it("still requires the authenticated userId", async () => {
    expect((await postReportBlob(reportRequest({ userId: "victim" }))).status).toBe(403)
    expect(mocks.put).not.toHaveBeenCalled()
  })

  it("keeps mirror-secret JSON uploads working without a user session", async () => {
    mocks.getWorkflowMirrorSecret.mockReturnValue("test-mirror-secret")
    const response = await postReportBlob(
      reportRequest({ userId: undefined }, { "x-dev3000-workflow-mirror-secret": "test-mirror-secret" })
    )
    expect(response.status).toBe(200)
    expect(mocks.getCurrentUserFromRequest).not.toHaveBeenCalled()
    expect(mocks.put).toHaveBeenCalled()
  })

  it("does not let the mirror secret bypass the content restrictions", async () => {
    mocks.getWorkflowMirrorSecret.mockReturnValue("test-mirror-secret")
    const response = await postReportBlob(
      reportRequest({ contentType: "image/svg+xml" }, { "x-dev3000-workflow-mirror-secret": "test-mirror-secret" })
    )
    expect(response.status).toBe(400)
    expect(mocks.put).not.toHaveBeenCalled()
  })
})
