import { Box, Text, useInput } from "ink"
import { useState } from "react"
import type { InstallLocation, SkillPackage } from "../utils/skill-installer.js"

interface PackageWithStatus extends SkillPackage {
  installed: boolean
}

interface PackageSelectorProps {
  packages: PackageWithStatus[]
  onComplete: (selectedPackages: SkillPackage[], location: InstallLocation) => void
  onSkip: () => void
}

export function PackageSelector({ packages, onComplete, onSkip }: PackageSelectorProps) {
  // Start with uninstalled packages selected
  const [selectedPackages, setSelectedPackages] = useState<Set<string>>(
    () => new Set(packages.filter((p) => !p.installed).map((p) => p.repo))
  )
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [installLocation, setInstallLocation] = useState<InstallLocation>("project")

  // Items: packages + location option
  const locationOptionIndex = packages.length
  const totalItems = packages.length + 1

  useInput((input, key) => {
    if (key.escape) {
      onSkip()
      return
    }

    if (key.return) {
      const selected = packages.filter((p) => selectedPackages.has(p.repo))
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

    // Left/right arrows toggle location when on the location option
    if (highlightedIndex === locationOptionIndex && (key.leftArrow || key.rightArrow)) {
      setInstallLocation((prev) => (prev === "project" ? "global" : "project"))
      return
    }

    if (input === " ") {
      if (highlightedIndex === locationOptionIndex) {
        // Toggle install location
        setInstallLocation((prev) => (prev === "project" ? "global" : "project"))
      } else {
        // Toggle individual package (only if not already installed)
        const pkg = packages[highlightedIndex]
        if (!pkg.installed) {
          const newSelected = new Set(selectedPackages)
          if (newSelected.has(pkg.repo)) {
            newSelected.delete(pkg.repo)
          } else {
            newSelected.add(pkg.repo)
          }
          setSelectedPackages(newSelected)
        }
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

  // Get install path based on location
  const getInstallPath = () => {
    if (installLocation === "global") {
      return "~/.agents/skills"
    }
    return ".agents/skills"
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color="#A18CE5" bold>
          d3k Skill Packages
        </Text>
      </Box>
      <Text color="#AAAAAA">Install skill packages for your project:</Text>
      <Box marginTop={1} flexDirection="column">
        {/* Package options */}
        {packages.map((pkg, index) => {
          const isHighlighted = highlightedIndex === index
          const isSelected = selectedPackages.has(pkg.repo)
          const isInstalled = pkg.installed

          return (
            <Box key={pkg.repo} flexDirection="column">
              {/* Package header with repo name */}
              <Box>
                {isInstalled ? <Text color="#888888">{"  "}[✓]</Text> : renderCheckbox(isSelected, isHighlighted)}
                <Text color={isInstalled ? "gray" : isHighlighted ? "#A18CE5" : undefined}>
                  {" "}
                  {pkg.repo}
                  {isInstalled && <Text color="green"> (installed)</Text>}
                </Text>
              </Box>
              {/* Individual skill names */}
              <Box flexDirection="column" marginLeft={6}>
                {pkg.skillFolders.map((skill) => (
                  <Text key={skill} color="#999999">
                    {skill}
                  </Text>
                ))}
              </Box>
            </Box>
          )
        })}

        {/* Install location option */}
        <Box marginTop={1} flexDirection="column">
          <Box>
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
          </Box>
          {/* Show path underneath */}
          <Box marginLeft={4}>
            <Text color="#888888">{getInstallPath()}</Text>
          </Box>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color="#888888">Space/arrows to toggle, Enter to install, Esc to skip</Text>
      </Box>
    </Box>
  )
}
