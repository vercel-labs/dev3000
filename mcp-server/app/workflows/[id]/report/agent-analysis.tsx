"use client"

import { Streamdown } from "streamdown"

export function AgentAnalysis({ content }: { content: string }) {
  return <Streamdown mode="static">{content}</Streamdown>
}
