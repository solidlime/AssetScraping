import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
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
      <body className="bg-background text-foreground antialiased">
        <header className="sticky top-0 z-30 border-b bg-card">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-2.5">
            <span className="text-sm font-bold tracking-tight">Asset Scraping</span>
            <Nav />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
