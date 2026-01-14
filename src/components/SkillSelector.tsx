import { Box, Text, useInput } from "ink"
import { useState } from "react"
import type { AvailableSkill, InstallLocation } from "../utils/skill-installer.js"

interface SkillSelectorProps {
  skills: AvailableSkill[]
  onComplete: (selectedSkills: AvailableSkill[], location: InstallLocation) => void
  onSkip: () => void
  initiallySelected?: string[] // Names of skills to pre-select (defaults to all)
}

export function SkillSelector({ skills, onComplete, onSkip, initiallySelected }: SkillSelectorProps) {
  // Start with specified skills selected, or all if not specified
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(() => {
    if (initiallySelected) {
      return new Set(initiallySelected.filter((name) => skills.some((s) => s.name === name)))
    }
    return new Set(skills.map((s) => s.name))
  })
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [installLocation, setInstallLocation] = useState<InstallLocation>("project")

  // Items: 0 = "All Skills", 1..n = skills, n+1 = "Install to: project/global"
  const locationOptionIndex = skills.length + 1
  const totalItems = skills.length + 2 // +1 for "All Skills", +1 for location option

  const allSelected = selectedSkills.size === skills.length

  useInput((input, key) => {
    if (key.escape) {
      onSkip()
      return
    }

    if (key.return) {
      const selected = skills.filter((s) => selectedSkills.has(s.name))
      onComplete(selected, installLocation)
      return
    }

    if (key.upArrow) {
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : totalItems - 1))
      return
    }

    if (key.downArrow) {
      setHighlightedIndex((prev) => (prev < totalItems - 1 ? prev + 1 : 0))
      return
    }

    if (input === " ") {
      if (highlightedIndex === 0) {
        // Toggle all
        if (allSelected) {
          setSelectedSkills(new Set())
        } else {
          setSelectedSkills(new Set(skills.map((s) => s.name)))
        }
      } else if (highlightedIndex === locationOptionIndex) {
        // Toggle install location
        setInstallLocation((prev) => (prev === "project" ? "global" : "project"))
      } else {
        // Toggle individual skill
        const skill = skills[highlightedIndex - 1]
        const newSelected = new Set(selectedSkills)
        if (newSelected.has(skill.name)) {
          newSelected.delete(skill.name)
        } else {
          newSelected.add(skill.name)
        }
        setSelectedSkills(newSelected)
      }
    }
  })

  const renderCheckbox = (checked: boolean, highlighted: boolean) => {
    const box = checked ? "[x]" : "[ ]"
    return (
      <Text color={highlighted ? "#A18CE5" : undefined}>
        {highlighted ? ">" : " "} {box}
      </Text>
    )
  }

  // Allow longer descriptions with word wrapping
  const formatDescription = (desc: string, maxLen: number = 80): string => {
    if (desc.length <= maxLen) return desc
    // Find a good break point (space) near maxLen
    const breakPoint = desc.lastIndexOf(" ", maxLen)
    if (breakPoint > maxLen * 0.6) {
      return `${desc.substring(0, breakPoint)}...`
    }
    return `${desc.substring(0, maxLen - 3)}...`
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color="#A18CE5" bold>
          d3k Skill Installer
        </Text>
      </Box>
      <Text dimColor>Skills available from Vercel:</Text>
      <Box marginTop={1} flexDirection="column">
        {/* All Skills option */}
        <Box>
          {renderCheckbox(allSelected, highlightedIndex === 0)}
          <Text color={highlightedIndex === 0 ? "#A18CE5" : undefined} bold>
            {" "}
            All Skills
          </Text>
        </Box>

        {/* Individual skills */}
        {skills.map((skill, index) => {
          const itemIndex = index + 1
          const isHighlighted = highlightedIndex === itemIndex
          const isSelected = selectedSkills.has(skill.name)
          const label = skill.isNew ? "(new)" : "(update)"

          return (
            <Box key={skill.name}>
              {renderCheckbox(isSelected, isHighlighted)}
              <Text color={isHighlighted ? "#A18CE5" : undefined}>
                {" "}
                {skill.name} <Text color={skill.isNew ? "green" : "yellow"}>{label}</Text>
                <Text dimColor> - {formatDescription(skill.description)}</Text>
              </Text>
            </Box>
          )
        })}

        {/* Install location option */}
        <Box marginTop={1}>
          <Text color={highlightedIndex === locationOptionIndex ? "#A18CE5" : undefined}>
            {highlightedIndex === locationOptionIndex ? ">" : " "} Install to:{" "}
          </Text>
          <Text color={installLocation === "project" ? "cyan" : "gray"} bold={installLocation === "project"}>
            [project]
          </Text>
          <Text> </Text>
          <Text color={installLocation === "global" ? "cyan" : "gray"} bold={installLocation === "global"}>
            [global]
          </Text>
          <Text dimColor>{installLocation === "project" ? " (.claude/skills/)" : " (~/.claude/skills/)"}</Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Space to toggle, Enter to install, Esc to skip</Text>
      </Box>
    </Box>
  )
}
