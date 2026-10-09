import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Asset Scraping — ssnb dashboard",
  description: "Money Forward SSNB 資産ダッシュボード",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className="bg-neutral-50 text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
