import { describe, expect, it } from "vitest"
import { parseDev3000LayoutShiftPayload } from "./screencast-manager"

describe("d3k layout-shift telemetry binding", () => {
  it("parses layout shifts and viewport data", () => {
    expect(
      parseDev3000LayoutShiftPayload(
        JSON.stringify({
          kind: "layout-shift",
          shift: {
            score: 0.125,
            timestamp: 42,
            sources: [
              {
                node: "DIV",
                position: "relative",
                previousRect: { x: 0, y: 0, width: 10, height: 10 },
                currentRect: { x: 0, y: 10, width: 10, height: 10 },
                actualRect: null
              }
            ]
          },
          viewport: { width: 1280, height: 720, devicePixelRatio: 1 }
        })
      )
    ).toEqual({
      kind: "layout-shift",
      shift: {
        score: 0.125,
        timestamp: 42,
        sources: [
          {
            node: "DIV",
            position: "relative",
            previousRect: { x: 0, y: 0, width: 10, height: 10 },
            currentRect: { x: 0, y: 10, width: 10, height: 10 },
            actualRect: null
          }
        ]
      },
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 }
    })
  })

  it("rejects malformed layout-shift payloads", () => {
    expect(parseDev3000LayoutShiftPayload("not-json")).toBeNull()
    expect(parseDev3000LayoutShiftPayload(JSON.stringify({ kind: "interaction" }))).toBeNull()
    expect(
      parseDev3000LayoutShiftPayload(JSON.stringify({ kind: "layout-shift", shift: { score: "bad", timestamp: 1 } }))
    ).toBeNull()
  })
})
