import { NextResponse } from "next/server"
import { getFeatureFlagProviderData } from "@/lib/feature-flags"

export async function GET() {
  return NextResponse.json(await getFeatureFlagProviderData())
}
