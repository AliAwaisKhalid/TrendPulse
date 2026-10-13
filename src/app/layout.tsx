import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trend Pulse — Google Trends with Diagnostics",
  description:
    "Fetch Google Trends data at its native hourly resolution, with diagnostics for duplication, window stitching and sparsity. Export to CSV, Excel, Stata, and R.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;700;800;900&family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
