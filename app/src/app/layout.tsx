import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Billingo → IMA admin",
  description: "Kimenő (vevői) számla szinkron, osztályozás és IMA export vezérlőfelület",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="hu" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
