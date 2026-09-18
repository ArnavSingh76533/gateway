import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./provider-hub.css";
const sans = localFont({
  src: "./fonts/Geist.woff2",
  variable: "--font-geist",
  display: "swap",
  weight: "100 900",
});
const mono = localFont({
  src: "./fonts/GeistMono.woff2",
  variable: "--font-geist-mono",
  display: "swap",
  weight: "100 900",
  preload: false,
});
export const metadata: Metadata = {
  title: "Nexus · Universal AI Gateway",
  description:
    "Connect your own AI providers to one OpenAI-compatible endpoint. Manage encrypted keys, discover models, test routing, and monitor usage in Nexus.",
  applicationName: "Nexus",
  openGraph: {
    title: "Nexus · Universal AI Gateway",
    description:
      "Your providers, connected. An independent control room for models, routing, and usage.",
    type: "website",
    siteName: "Nexus",
  },
  twitter: {
    card: "summary",
    title: "Nexus · Universal AI Gateway",
    description:
      "Connect your AI providers. Manage models, routing, and usage in one workspace.",
  },
  icons: { icon: "/favicon.svg" },
};
export const viewport: Viewport = {
  themeColor: "#0b0c10",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
