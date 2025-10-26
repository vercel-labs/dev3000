import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "dev3000 + Next.js 16 Demo",
  description:
    "AI-powered development tools with Next.js 16, builtin MCP, and Context7 integration",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
