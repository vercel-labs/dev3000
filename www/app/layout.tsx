import type React from "react"
import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { Analytics } from "@vercel/analytics/next"
import { Suspense } from "react"
import "./globals.css"

export const metadata: Metadata = {
  title: "dev3000 - AI-Powered Debugging & Development Monitoring | Vercel Labs",
  description:
    "Capture your web app's complete development timeline with dev3000. Unified server logs, browser events, console messages, network requests, and automatic screenshots for AI debugging. Perfect for Next.js, React, and modern web development.",
  keywords: [
    "AI debugging",
    "web development tools", 
    "Next.js debugging",
    "React debugging",
    "development monitoring",
    "server logs",
    "browser automation",
    "Claude AI",
    "MCP protocol",
    "developer tools",
    "Vercel Labs"
  ],
  authors: [{ name: "Vercel Labs" }, { name: "elsigh", url: "https://github.com/elsigh" }],
  creator: "Vercel Labs",
  publisher: "Vercel Labs",
  openGraph: {
    title: "dev3000 - AI-Powered Debugging & Development Monitoring",
    description: "Capture your web app's complete development timeline for AI debugging. Unified logs, browser events, and automatic screenshots.",
    url: "https://dev3000.vercel.app",
    siteName: "dev3000",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/d3k-og.svg",
        width: 1200,
        height: 630,
        alt: "d3k - AI-powered development browser with unified logs and real-time monitoring"
      }
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "dev3000 - AI-Powered Debugging & Development Monitoring", 
    description: "Capture your web app's complete development timeline for AI debugging. Unified logs, browser events, and automatic screenshots.",
    creator: "@vercel",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  category: "technology",
  icons: {
    icon: [
      { url: "/favicon-16.svg", type: "image/svg+xml", sizes: "16x16" },
      { url: "/favicon.svg", type: "image/svg+xml", sizes: "32x32" },
      { url: "/favicon-64.svg", type: "image/svg+xml", sizes: "64x64" }
    ],
    shortcut: "/favicon.svg",
    apple: "/favicon-64.svg"
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable}`}>
        <Suspense fallback={null}>{children}</Suspense>
        <Analytics />
      </body>
    </html>
  )
}