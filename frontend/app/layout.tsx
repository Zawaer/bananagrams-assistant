import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted so the build never has to reach Google Fonts. Both files are the Latin
// subset (covers ä, ö, å) of the variable fonts as served by Google Fonts (Geist v5,
// Bricolage Grotesque v9), under the SIL Open Font License (see app/fonts/OFL-*.txt).
const body = localFont({
  variable: "--font-body",
  src: "./fonts/Geist-Variable-latin.woff2",
  weight: "100 900",
});
// A display face with some character, for headings and the tile letters.
const display = localFont({
  variable: "--font-display",
  src: [
    { path: "./fonts/BricolageGrotesque-Variable-latin.woff2", weight: "600" },
    { path: "./fonts/BricolageGrotesque-Variable-latin.woff2", weight: "800" },
  ],
});

export const metadata: Metadata = {
  title: "Bananagrams Assistant",
  description: "Photograph your Bananagrams tiles and get a grid that uses every one.",
};

export const viewport: Viewport = {
  themeColor: "#f4eddc",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${body.variable} ${display.variable} antialiased`}>{children}</body>
    </html>
  );
}
