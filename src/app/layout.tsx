import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeScript } from "@/components/theme-script";
import "./globals.css";

// Geist for text; Geist Mono (tabular) for timers and money, so ticking digits don't jitter.
const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: "QueSys", template: "%s · QueSys" },
  description: "Timers, billing and PC control for gaming lounges and snooker / pool halls.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets iPhones report the home-bar / notch areas (env(safe-area-inset-*)), which the bottom
  // bar, sheets and pinned buttons keep clear of.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0b0e" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set by ThemeScript before React hydrates.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
