import { Box, Text, useInput } from "ink"
import SelectInput from "ink-select-input"
import { useState } from "react"
import type { AgentOption } from "../utils/agent-selection.js"
import type { AgentConfig } from "../utils/user-config.js"

type Step = "select-agent" | "custom-input"

interface SelectItem {
  label: string
  value: string
}

interface AgentSelectorProps {
  agents: AgentOption[]
  defaultAgentName?: string
  onComplete: (result: { agent: AgentConfig | null }) => void
}

export function AgentSelector({ agents, defaultAgentName, onComplete }: AgentSelectorProps) {
  const [step, setStep] = useState<Step>("select-agent")
  const [customCommand, setCustomCommand] = useState("")

  // Build items for agent selection, with default at top if it exists
  const buildAgentItems = (): SelectItem[] => {
    const items: SelectItem[] = []

    // Sort agents: available first (with default at very top), then unavailable
    const sortedAgents = [...agents].sort((a, b) => {
      // First, separate available from unavailable
      if (a.available && !b.available) return -1
      if (!a.available && b.available) return 1
      // Within available agents, put default first
      if (a.available && b.available) {
        if (a.name === defaultAgentName) return -1
        if (b.name === defaultAgentName) return 1
      }
      return 0
    })

    for (const agent of sortedAgents) {
      items.push({
        label: agent.available ? agent.displayName : `${agent.displayName} (not installed)`,
        value: agent.available ? agent.name : `disabled:${agent.name}`
      })
    }

    items.push({ label: "Custom command...", value: "custom" })
    items.push({ label: "d3k (no agent)", value: "none" })
    items.push({ label: "d3k --debug", value: "debug" })

    return items
  }

  const agentItems = buildAgentItems()

  // Handle agent selection
  const handleAgentSelect = (item: SelectItem) => {
    if (item.value.startsWith("disabled:")) {
      return // Ignore disabled items
    }

    if (item.value === "none") {
      // User chose no agent
      onComplete({ agent: null })
      return
    }

    if (item.value === "debug") {
      // User chose debug mode
      onComplete({ agent: { name: "debug", command: "debug" } })
      return
    }

    if (item.value === "custom") {
      setStep("custom-input")
      return
    }

    // Simple agent selection - complete immediately
    const agent = agents.find((a) => a.name === item.value)
    // Use custom command if specified, otherwise fall back to binary name
    onComplete({ agent: { name: item.value, command: agent?.command || agent?.binary || item.value } })
  }

  // Handle custom command input
  useInput(
    (input, key) => {
      if (step !== "custom-input") return

      if (key.return) {
        if (customCommand.trim()) {
          onComplete({ agent: { name: "custom", command: customCommand.trim() } })
        }
        return
      }

      if (key.backspace || key.delete) {
        setCustomCommand((prev) => prev.slice(0, -1))
        return
      }

      if (key.escape) {
        setStep("select-agent")
        setCustomCommand("")
        return
      }

      // Regular character input
      if (input && !key.ctrl && !key.meta) {
        setCustomCommand((prev) => prev + input)
      }
    },
    { isActive: step === "custom-input" }
  )

  // Render based on current step
  if (step === "select-agent") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text color="#A18CE5" bold>
            d3k Agent Selection
          </Text>
        </Box>
        <Text dimColor>Select an AI agent to run alongside d3k:</Text>
        <Box marginTop={1}>
          <SelectInput
            items={agentItems}
            onSelect={handleAgentSelect}
            indicatorComponent={({ isSelected }) => <Text color="#A18CE5">{isSelected ? "❯ " : "  "}</Text>}
            itemComponent={({ isSelected, label }) => {
              const isDisabled = label.includes("not installed")
              return (
                <Text color={isDisabled ? "gray" : isSelected ? "#A18CE5" : undefined} dimColor={isDisabled}>
                  {label}
                </Text>
              )
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Use ↑↓ to navigate, Enter to select</Text>
        </Box>
      </Box>
    )
  }

  if (step === "custom-input") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text color="#A18CE5" bold>
            Custom Command
          </Text>
        </Box>
        <Text dimColor>Enter the command to run your agent:</Text>
        <Box marginTop={1}>
          <Text color="#A18CE5">❯ </Text>
          <Text>{customCommand}</Text>
          <Text color="gray">▌</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press Enter to confirm, Esc to go back</Text>
        </Box>
      </Box>
    )
  }

  return null
}
