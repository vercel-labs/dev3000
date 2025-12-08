"use client"

import { Streamdown } from "streamdown"

export function ReportMarkdown({ children }: { children: string }) {
  return (
    <Streamdown
      mode="static"
      components={{
        img: (props) => {
          const src = typeof props.src === "string" ? props.src : undefined
          return (
            <a href={src} target="_blank" rel="noopener noreferrer" className="inline-block">
              <img
                src={src}
                alt={props.alt}
                className="w-48 h-auto rounded border border-border hover:border-primary transition-colors cursor-pointer"
              />
            </a>
          )
        }
      }}
    >
      {children}
    </Streamdown>
  )
}
