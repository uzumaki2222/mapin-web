import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { PUBLIC_APP_URL } from "@/lib/config/public";

// Icons and social previews come from the file conventions in /app:
// icon.png, apple-icon.png, opengraph-image.png, twitter-image.png (all made from the official logo).
export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_APP_URL),
  title: { default: "mapin — tokenize any business on earth", template: "%s · mapin" },
  description: "Find any shop, café or restaurant on the world map and tokenize it on Robinhood Chain. A share of every trade is held for the real owner.",
  applicationName: "mapin",
  openGraph: {
    type: "website",
    siteName: "mapin",
    title: "mapin — tokenize any business on earth",
    description: "Find any shop, café or restaurant on the world map and tokenize it on Robinhood Chain.",
  },
  twitter: { card: "summary_large_image", title: "mapin — tokenize any business on earth" },
};

export const viewport: Viewport = { themeColor: "#efe2c4" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,800&family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600&display=swap"
        />
      </head>
      <body>
        <Providers>
          <Header />
          <main>{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
