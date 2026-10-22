import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import type React from "react"
import { Suspense } from "react"
import { NextDevIndicatorFix } from "@/components/next-dev-indicator-fix"
import { ThemeProvider } from "@/components/theme-provider"
import { DEV3000_URL } from "@/lib/constants"
import { AnalyticsTools } from "./analytics.client"
import "./globals.css"

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  adjustFontFallback: true
})

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  adjustFontFallback: true
})

export const metadata: Metadata = {
  metadataBase: new URL(DEV3000_URL),
  title: "d3k - Browser and server evidence for your coding agent | Vercel Labs",
  description:
    "Give your coding agent a managed browser and a shared timeline of server output, browser errors, and network requests with the d3k skill.",
  keywords: [
    "AI debugging",
    "web development tools",
    "Next.js debugging",
    "React debugging",
    "development monitoring",
    "server logs",
    "browser automation",
    "Claude AI",
    "developer tools",
    "Vercel Labs"
  ],
  authors: [{ name: "Vercel Labs" }, { name: "elsigh", url: "https://github.com/elsigh" }],
  creator: "Vercel Labs",
  publisher: "Vercel Labs",
  openGraph: {
    title: "dev3000 - AI-Powered Debugging & Development Monitoring",
    description: "A managed browser and a shared server/browser evidence timeline for your coding agent.",
    url: DEV3000_URL,
    siteName: "dev3000",
    type: "website",
    locale: "en_US"
  },
  twitter: {
    card: "summary_large_image",
    title: "dev3000 - AI-Powered Debugging & Development Monitoring",
    description: "A managed browser and a shared server/browser evidence timeline for your coding agent.",
    creator: "@vercel"
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true
    }
  },
  category: "technology",
  icons: {
    icon: [
      { url: "/favicon.ico", type: "image/x-icon" },
      { url: "/favicon-16.svg", type: "image/svg+xml", sizes: "16x16" },
      { url: "/favicon.svg", type: "image/svg+xml", sizes: "32x32" },
      { url: "/favicon-64.svg", type: "image/svg+xml", sizes: "64x64" }
    ],
    shortcut: "/favicon.svg",
    apple: "/favicon-180.png"
  }
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="font-sans">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <Suspense fallback={null}>{children}</Suspense>
        </ThemeProvider>
        <NextDevIndicatorFix />
        <Suspense fallback={null}>
          <AnalyticsTools />
        </Suspense>
      </body>
    </html>
  )
}
