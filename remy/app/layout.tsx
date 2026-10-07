import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Remy Mux — Fuel your running",
  applicationName: "Remy Mux",
  description: "Your private nutrition and marathon-training journal.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.svg", apple: "/icon-192.png" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
