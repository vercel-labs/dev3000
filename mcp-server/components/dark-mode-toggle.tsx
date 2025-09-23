"use client"

import { Moon, Sun } from "lucide-react"
import { Button } from "./ui/button"

interface DarkModeToggleProps {
  darkMode: boolean
  setDarkMode: (value: boolean) => void
  className?: string
}

export function DarkModeToggle({ darkMode, setDarkMode, className }: DarkModeToggleProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setDarkMode(!darkMode)}
      className={className}
      aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
    >
      {darkMode ? <Sun className="h-5 w-5 transition-all" /> : <Moon className="h-5 w-5 transition-all" />}
    </Button>
  )
}
