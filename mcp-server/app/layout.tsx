import type React from "react"
import { ViewTransition } from "react"
import "./globals.css"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition>
      <html lang="en" className="h-full">
        <head>
          <title>dev3000</title>
          <link rel="icon" href="/favicon.ico" type="image/x-icon" />
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" sizes="32x32" />
          <link rel="icon" href="/favicon-16.svg" type="image/svg+xml" sizes="16x16" />
          <link rel="icon" href="/favicon-64.svg" type="image/svg+xml" sizes="64x64" />
          <link rel="apple-touch-icon" href="/favicon-180.png" />
          <link rel="shortcut icon" href="/favicon.svg" />
          <meta name="theme-color" content="#1f2937" />
        </head>
        <body className="h-full">{children}</body>
      </html>
    </ViewTransition>
  )
}
