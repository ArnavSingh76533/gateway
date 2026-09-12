import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Nexus · Universal AI Gateway",
  description: "Your providers. One endpoint. A self-hosted AI control room.",
  icons: { icon: "/favicon.svg" },
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
