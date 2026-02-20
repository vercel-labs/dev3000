"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useRef, useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button"

interface ThemeToggleProps {
  className?: string
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  if (!isClient) {
    return (
      <Button variant="outline" size="icon" className={className} aria-label="Toggle theme">
        <Sun className="h-4 w-4" />
      </Button>
    )
  }

  const isDark = resolvedTheme !== "light"
  const nextTheme = isDark ? "light" : "dark"

  const handleToggle = () => {
    const transitionDoc = document as Document & {
      startViewTransition?: (update: () => void) => { ready: Promise<void> }
    }

    if (!transitionDoc.startViewTransition || !buttonRef.current) {
      setTheme(nextTheme)
      return
    }

    const rect = buttonRef.current.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const maxRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))

    const transition = transitionDoc.startViewTransition(() => {
      setTheme(nextTheme)
    })

    transition.ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${maxRadius}px at ${x}px ${y}px)`]
        },
        {
          duration: 520,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          pseudoElement: "::view-transition-new(root)"
        }
      )
    })
  }

  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="outline"
      size="icon"
      className={className}
      onClick={handleToggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  )
}
