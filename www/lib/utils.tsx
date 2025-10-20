import { type ClassValue, clsx } from "clsx"
import type React from "react"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Strip markdown syntax for plain text display
export const stripMarkdown = (text: string): string => {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1") // Remove bold **text**
    .replace(/\[(.*?)\]\(.*?\)/g, "$1") // Remove links [text](url) -> text
}

// Convert markdown to React elements
export const parseMarkdown = (text: string) => {
  const parts: (string | React.JSX.Element)[] = []
  let currentIndex = 0
  let key = 0

  // Match **bold**, [link](url), and regular text
  const regex = /(\*\*.*?\*\*|\[.*?\]\(.*?\))/g
  let match: RegExpExecArray | null = regex.exec(text)

  while (match !== null) {
    // Add text before the match
    if (match.index > currentIndex) {
      parts.push(text.slice(currentIndex, match.index))
    }

    const matchedText = match[0]

    // Handle bold **text**
    if (matchedText.startsWith("**") && matchedText.endsWith("**")) {
      const boldText = matchedText.slice(2, -2)
      parts.push(
        <strong key={`bold-${key++}`} className="font-semibold">
          {boldText}
        </strong>
      )
    }
    // Handle links [text](url)
    else if (matchedText.startsWith("[")) {
      const linkMatch = matchedText.match(/\[(.*?)\]\((.*?)\)/)
      if (linkMatch) {
        const [, linkText, url] = linkMatch
        parts.push(
          <a
            key={`link-${key++}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:underline"
          >
            {linkText}
          </a>
        )
      }
    }

    currentIndex = match.index + matchedText.length
    match = regex.exec(text)
  }

  // Add remaining text
  if (currentIndex < text.length) {
    parts.push(text.slice(currentIndex))
  }

  return parts.length > 0 ? parts : text
}
