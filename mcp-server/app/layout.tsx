export default function RootLayout({ children }: any) {
  return (
    <html lang="en" className="h-full">
      <head>
        <title>🎯 dev3000</title>
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon-16.svg" type="image/svg+xml" sizes="16x16" />
        <link rel="apple-touch-icon" href="/favicon-180.png" />
        <meta name="theme-color" content="#1f2937" />
        <script src="https://cdn.tailwindcss.com"></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              tailwind.config = {
                darkMode: 'class',
              }
            `
          }}
        />
      </head>
      <body className="h-full">{children}</body>
    </html>
  )
}
