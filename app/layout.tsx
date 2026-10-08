import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["200", "300"],
  display: "swap",
  variable: "--font-outfit",
});

export const metadata: Metadata = {
  title: "In-Fun.net",
  description:
    "Step into the white core of In-Fun.net and speak with the light inside the spiral.",
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html className={outfit.variable} lang="en">
      <body>{children}</body>
    </html>
  );
}
