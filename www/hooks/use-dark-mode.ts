import { useEffect, useState } from "react"

export function useDarkMode() {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      // Check localStorage first
      const saved = localStorage.getItem("dev3000-dark-mode")
      if (saved !== null) {
        return JSON.parse(saved)
      }
      // Default to system preference
      return window.matchMedia("(prefers-color-scheme: dark)").matches
    }
    return false
  })

  useEffect(() => {
    // Save to localStorage
    localStorage.setItem("dev3000-dark-mode", JSON.stringify(darkMode))

    // Apply dark class to document
    if (darkMode) {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
  }, [darkMode])

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = (e: MediaQueryListEvent) => {
      // Only update if no explicit choice has been made
      const saved = localStorage.getItem("dev3000-dark-mode")
      if (saved === null) {
        setDarkMode(e.matches)
      }
    }

    mediaQuery.addEventListener("change", handler)
    return () => mediaQuery.removeEventListener("change", handler)
  }, [])

  return [darkMode, setDarkMode] as const
}