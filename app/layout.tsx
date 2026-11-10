import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import { TabBar } from "@/components/push/TabBar";
import "./globals.css";

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ui",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FINN",
  description: "What changed in your portfolio, and what management promised versus delivered.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1018" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={plex.variable} suppressHydrationWarning>
      <body>
        {children}
        <TabBar />
      </body>
    </html>
  );
}