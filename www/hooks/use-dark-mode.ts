import { useEffect, useState } from "react"

export function useDarkMode() {
  // Initialize with false to avoid hydration mismatch
  const [darkMode, setDarkMode] = useState<boolean>(false)
  const [isInitialized, setIsInitialized] = useState(false)

  // Initialize after hydration
  useEffect(() => {
    if (!isInitialized) {
      // Check localStorage first
      const saved = localStorage.getItem("dev3000-dark-mode")
      if (saved !== null) {
        setDarkMode(JSON.parse(saved))
      } else {
        // Default to system preference
        setDarkMode(window.matchMedia("(prefers-color-scheme: dark)").matches)
      }
      setIsInitialized(true)
    }
  }, [isInitialized])

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
