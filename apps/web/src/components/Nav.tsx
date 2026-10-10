"use client";

import { LayoutDashboard, Landmark, Scale, ArrowLeftRight, Lightbulb, Calculator, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export const NAV_ITEMS = [
  { title: "ダッシュボード", href: "/", icon: LayoutDashboard },
  { title: "口座", href: "/accounts", icon: Landmark },
  { title: "B/S", href: "/bs", icon: Scale },
  { title: "C/F", href: "/cf", icon: ArrowLeftRight },
  { title: "インサイト", href: "/insights", icon: Lightbulb },
  { title: "シミュレーター", href: "/simulator", icon: Calculator },
  { title: "設定", href: "/settings", icon: Settings },
] as const;

// TODO(後続フェーズ): 各ページ実装時に本配列を参照してルーティングを結線する

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-1" aria-label="メインナビゲーション">
      {NAV_ITEMS.map((item) => {
        const isActive =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-foreground/70 hover:bg-muted hover:text-foreground",
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.title}
          </Link>
        );
      })}
    </nav>
  );
}
