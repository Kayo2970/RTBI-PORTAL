import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { HapticFeedbackProvider } from "@/components/haptic-feedback-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Favicon/apple-touch-icon are intentionally NOT declared here — src/app/icon.png,
// favicon.ico, and apple-icon.png already exist and Next.js auto-generates the
// correct <link rel="icon">/<link rel="apple-touch-icon"> tags (with cache-busted
// URLs) from those files. Declaring `icons` in metadata as well used to produce
// four overlapping, conflicting icon <link> tags at once — which browsers can
// resolve inconsistently, showing a blank/default tab icon.
export const metadata: Metadata = {
  title: "LEADS All-in-One Dashboard",
  description: "Private internal management system for the RTBI Portal at MSRUAS, Bengaluru.",
  // Lets iOS Safari's "Add to Home Screen" open this as a standalone app
  // (own icon, no browser chrome/URL bar) instead of just a bookmark that
  // reopens in a normal Safari tab — see components/ios-install-prompt.tsx
  // for the banner that tells iOS visitors this option exists at all (iOS
  // has no install-prompt API like Android/Chrome's beforeinstallprompt, so
  // nothing surfaces this on its own).
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "RTBI Portal",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <HapticFeedbackProvider />
        {children}
        {/* Cloudflare Web Analytics */}
        <Script
          strategy="afterInteractive"
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon='{"token": "edc6acebaad34f76a57c25783df697fe"}'
        />
      </body>
    </html>
  );
}
