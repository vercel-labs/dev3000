import { NextResponse } from "next/server"

export async function GET() {
  // Simple endpoint that returns feature flag definitions
  // This was previously using the flags SDK, but we've simplified
  // to avoid "headers called outside request scope" errors
  return NextResponse.json({
    definitions: {
      "demo-cls-bugs": {
        description: "Enable intentional CLS bugs for demo purposes",
        origin: "https://dev3000.ai",
        options: [
          { value: false, label: "Disabled" },
          { value: true, label: "Enabled" }
        ]
      }
    }
  })
}
