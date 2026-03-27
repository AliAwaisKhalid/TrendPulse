import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrendPulse",
  description: "Google Trends Analyzer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}