import { describe, expect, it, vi } from "vitest"
import type { CDPEvent } from "../cdp-monitor.js"
import { createBrowserEventRecorder } from "./browser-events.js"
import { NETWORK_BODY_LIMIT, NETWORK_RESOURCE_LIMIT } from "./network-evidence.js"
import { Timeline } from "./timeline.js"

function fixture(body = '{"ok":true,"access_token":"response-secret"}') {
  const timeline = new Timeline()
  const readResponseBody = vi.fn(async () => ({ body, base64Encoded: false }))
  const record = createBrowserEventRecorder(timeline, { appUrl: "https://app.localhost", readResponseBody })
  const emit = (method: string, params: Record<string, unknown>, sessionId?: string) =>
    record({ method: `Network.${method}`, params: { requestId: "r1", ...params }, timestamp: Date.now(), sessionId })
  const request = (url = "https://app.localhost/api?key=query-secret", extra: Record<string, unknown> = {}) =>
    emit("requestWillBeSent", {
      timestamp: 10,
      type: "Fetch",
      request: {
        url,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer header-secret",
          Cookie: "session=cookie-secret",
          "x-debug": "keep-me"
        },
        postData: JSON.stringify({ name: "example", nested: { password: "request-secret" } }),
        ...extra
      }
    })
  const response = (extra: Record<string, unknown> = {}) =>
    emit("responseReceived", {
      response: {
        url: "https://app.localhost/api",
        status: 200,
        headers: {
          "content-type": "application/json",
          "Set-Cookie": "session=response-cookie-secret",
          "x-request-id": "trace-123"
        },
        timing: {
          requestTime: 10,
          dnsStart: 1,
          dnsEnd: 3,
          connectStart: 3,
          connectEnd: 9,
          sslStart: 4,
          sslEnd: 8,
          sendStart: 9,
          sendEnd: 10,
          receiveHeadersEnd: 100
        },
        ...extra
      }
    })
  const finish = () => emit("loadingFinished", { timestamp: 10.15, encodedDataLength: 250 })
  const events = () => timeline.read().events
  const data = (kind: string) => events().find((e) => e.kind === kind)?.data
  return { timeline, readResponseBody, emit, request, response, finish, events, data }
}

describe("network evidence", () => {
  it("redacts HTTP/2 query strings and relative redirects while retaining :authority", () => {
    const f = fixture()
    f.emit("requestWillBeSentExtraInfo", {
      headers: {
        ":authority": "app.localhost",
        ":path": "/api?token=wire-secret",
        "x-original-url": "/api?key=original-secret",
        cookie: "wire-cookie-secret"
      }
    })
    f.emit("responseReceivedExtraInfo", {
      statusCode: 302,
      headers: {
        location: "/login?code=redirect-secret",
        "set-cookie": "wire-response-secret",
        "content-security-policy": "default-src 'self'"
      }
    })
    expect(f.data("request-headers")?.headers).toEqual({
      ":authority": "app.localhost",
      ":path": "/api?redacted",
      "x-original-url": "/api?redacted",
      cookie: "[redacted]"
    })
    expect(f.data("response-headers")?.headers).toEqual({
      location: "/login?redacted",
      "set-cookie": "[redacted]",
      "content-security-policy": "default-src 'self'"
    })
    expect(JSON.stringify(f.events())).not.toContain("-secret")
  })
  it("retains useful headers and JSON while redacting credentials recursively", async () => {
    const f = fixture()
    f.request()
    f.response()
    expect(f.readResponseBody).not.toHaveBeenCalled()
    f.finish()
    await vi.waitFor(() => expect(f.data("response-body")).toBeDefined())
    expect(f.readResponseBody).toHaveBeenCalledWith("r1")
    expect(f.data("request")?.headers).toMatchObject({
      "x-debug": "keep-me",
      authorization: "[redacted]",
      cookie: "[redacted]"
    })
    expect(f.data("response")?.headers).toMatchObject({ "x-request-id": "trace-123", "set-cookie": "[redacted]" })
    expect(f.data("request")?.body).toMatchObject({ text: '{"name":"example","nested":{"password":"[redacted]"}}' })
    expect(f.data("response-body")?.body).toMatchObject({ text: '{"ok":true,"access_token":"[redacted]"}' })
    expect(JSON.stringify(f.events())).not.toContain("-secret")
  })

  it("calculates milliseconds from CDP's mixed seconds and millisecond timestamps", () => {
    const f = fixture()
    f.request()
    f.response()
    f.finish()
    expect(f.data("network-complete")?.timing).toEqual({
      dnsMs: 2,
      connectMs: 6,
      tlsMs: 4,
      sendMs: 1,
      ttfbMs: 100,
      downloadMs: 50,
      totalMs: 150
    })
    expect(f.data("response")?.cdpTiming).toMatchObject({ requestTime: 10, receiveHeadersEnd: 100 })
  })

  it("does not invent phases when connections are reused or timing is unavailable", () => {
    const f = fixture()
    f.request()
    f.response({ fromDiskCache: true, timing: { requestTime: 10, dnsStart: -1, dnsEnd: -1, receiveHeadersEnd: -1 } })
    f.finish()
    expect(f.data("network-complete")?.timing).toEqual({ totalMs: 150 })
  })

  it("measures TTFB at the first byte and download time after headers finish", () => {
    const f = fixture()
    f.request()
    f.response({ timing: { requestTime: 10, receiveHeadersStart: 80, receiveHeadersEnd: 100 } })
    f.finish()
    expect(f.data("network-complete")?.timing).toEqual({ ttfbMs: 80, downloadMs: 50, totalMs: 150 })
  })

  it("preserves form duplicates and redacts encoded credential names", () => {
    const f = fixture()
    f.request(undefined, {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      postData: "tag=a&tag=b&%70assword=form-secret&csrf=csrf-secret"
    })
    expect(f.data("request")?.body).toMatchObject({ text: "tag=a&tag=b&password=%5Bredacted%5D&csrf=%5Bredacted%5D" })
  })

  it.each([
    ["cross-origin", "https://external.example/api", { "content-type": "application/json" }, 12],
    ["unsupported-content-type", "https://app.localhost/api", { "content-type": "image/png" }, 12],
    ["unsupported-content-type", "https://app.localhost/api", { "content-type": "text/event-stream" }, 12],
    ["too-large", "https://app.localhost/api", { "content-type": "application/json" }, NETWORK_RESOURCE_LIMIT + 1]
  ])("omits %s responses before fetching bodies", (reason, url, headers, encodedDataLength) => {
    const f = fixture()
    f.request(url)
    f.response({ headers })
    f.emit("loadingFinished", { timestamp: 11, encodedDataLength })
    expect(f.readResponseBody).not.toHaveBeenCalled()
    expect(f.data("response-body")?.body).toEqual({ omitted: reason })
  })

  it("bounds decoded body previews and redacts before truncating", async () => {
    const f = fixture(JSON.stringify({ token: "never-show", data: "x".repeat(NETWORK_BODY_LIMIT * 2) }))
    f.request()
    f.response()
    f.finish()
    await vi.waitFor(() => expect(f.data("response-body")).toBeDefined())
    const body = f.data("response-body")?.body as { text: string; truncated: boolean }
    expect(Buffer.byteLength(body.text)).toBeLessThanOrEqual(NETWORK_BODY_LIMIT)
    expect(body.truncated).toBe(true)
    expect(body.text).not.toContain("never-show")
  })

  it("decodes base64 JSON and reports body retrieval failures without leaking CDP errors", async () => {
    const f = fixture()
    f.readResponseBody.mockResolvedValueOnce({
      body: Buffer.from('{"ok":true}').toString("base64"),
      base64Encoded: true
    })
    f.request()
    f.response()
    f.finish()
    await vi.waitFor(() => expect(f.data("response-body")).toBeDefined())
    expect(f.data("response-body")?.body).toMatchObject({ text: '{"ok":true}' })
    f.readResponseBody.mockRejectedValueOnce(new Error("backend-secret"))
    f.request()
    f.response()
    f.finish()
    await vi.waitFor(() => expect(f.events().filter((e) => e.kind === "response-body")).toHaveLength(2))
    expect(f.events().at(-1)?.data?.body).toEqual({ omitted: "unavailable" })
    expect(JSON.stringify(f.events())).not.toContain("backend-secret")
  })

  it("omits malformed JSON rather than exposing partially parsed credentials", async () => {
    const f = fixture('{"token":"never-show"')
    f.request()
    f.response()
    f.finish()
    await vi.waitFor(() => expect(f.data("response-body")).toBeDefined())
    expect(f.data("response-body")?.body).toMatchObject({ omitted: "unparseable" })
    expect(JSON.stringify(f.events())).not.toContain("never-show")
  })

  it("retains redirect responses and uses the final hop for body capture and timing", async () => {
    const f = fixture()
    f.request("https://external.example/redirect")
    f.emit("requestWillBeSent", {
      timestamp: 10.05,
      type: "Fetch",
      request: { url: "https://app.localhost/api", method: "GET" },
      redirectResponse: {
        url: "https://external.example/redirect",
        status: 302,
        headers: { location: "https://app.localhost/api?token=redirect-secret" }
      }
    })
    f.response()
    f.finish()
    await vi.waitFor(() => expect(f.data("response-body")).toBeDefined())
    expect(f.data("response")?.redirect).toBe(true)
    expect(f.data("network-complete")?.timing).toMatchObject({ totalMs: 100, ttfbMs: 50 })
    expect(JSON.stringify(f.events())).not.toContain("redirect-secret")
  })

  it("records failed requests and cancellation without trying to fetch a body", () => {
    const f = fixture()
    f.request()
    f.emit("loadingFailed", { timestamp: 10.1, errorText: "net::ERR_ABORTED", canceled: true })
    expect(f.data("network-failure")?.timing).toEqual({ totalMs: 100 })
    expect(f.events().at(-1)?.level).toBe("info")
    expect(f.readResponseBody).not.toHaveBeenCalled()
  })

  it("bounds concurrent body retrieval without blocking subsequent events", () => {
    const f = fixture()
    f.readResponseBody.mockImplementation(() => new Promise(() => {}))
    for (let i = 0; i < 9; i++) {
      f.request()
      f.response()
      f.finish()
    }
    expect(f.readResponseBody).toHaveBeenCalledTimes(8)
    expect(f.data("response-body")?.body).toEqual({ omitted: "capture-busy" })
    expect(f.events().filter((e) => e.kind === "network-complete")).toHaveLength(9)
  })

  it("separates identical request IDs across CDP targets", () => {
    const f = fixture()
    for (const [sessionId, timestamp] of [
      ["a", 10],
      ["b", 11]
    ] as const) {
      const event: CDPEvent = {
        method: "Network.requestWillBeSent",
        timestamp: 1,
        sessionId,
        params: {
          requestId: "r1",
          timestamp,
          type: "Document",
          request: { url: "https://app.localhost", method: "GET" }
        }
      }
      f.emit("requestWillBeSent", event.params, sessionId)
    }
    f.emit("loadingFinished", { timestamp: 11.2 }, "a")
    f.emit("loadingFinished", { timestamp: 11.3 }, "b")
    expect(
      f
        .events()
        .filter((e) => e.kind === "network-complete")
        .map((e) => e.data?.timing)
    ).toEqual([{ totalMs: 1200 }, { totalMs: 300 }])
  })
})
