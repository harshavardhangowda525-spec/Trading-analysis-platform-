import type { Metadata, Viewport } from "next";
import { Manrope, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: { default: "TRADEOS — Trading Intelligence", template: "%s · TRADEOS" },
  description: "AI-powered trading journal, Zerodha sync and evidence-based performance analytics. Analytics only — no order execution.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#06070a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN" className={`${manrope.variable} ${mono.variable}`}>
      <body className="relative">
        <div className="relative z-[1]">{children}</div>
      </body>
    </html>
  );
}
