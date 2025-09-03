import React from 'react';

export default function RootLayout({
  children,
}: any) {
  return (
    <html lang="en">
      <head>
        <title>🎯 dev3000</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body>{children}</body>
    </html>
  );
}