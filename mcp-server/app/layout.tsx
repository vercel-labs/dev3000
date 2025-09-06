import React from 'react';

export default function RootLayout({
  children,
}: any) {
  return (
    <html lang="en" className="h-full">
      <head>
        <title>🎯 dev3000</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              tailwind.config = {
                darkMode: 'class',
              }
            `,
          }}
        />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}