"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";

type TabType = "summary" | "transactions";

const CFTabContext = createContext<{
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
} | null>(null);

function useCFTab() {
  const context = useContext(CFTabContext);
  if (!context) throw new Error("useCFTab must be used within CFTabProvider");
  return context;
}

export function CFTabProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tabParam = searchParams.get("tab");
  const activeTab: TabType = tabParam === "transactions" ? "transactions" : "summary";

  const setActiveTab = (tab: TabType) => {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "summary") {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }
    const query = params.toString();
    router.push(`${pathname}${query ? `?${query}` : ""}`, {
      scroll: false,
    });
  };

  return (
    <CFTabContext.Provider value={{ activeTab, setActiveTab }}>{children}</CFTabContext.Provider>
  );
}

export function CFTabSelector() {
  const { activeTab, setActiveTab } = useCFTab();

  return (
    <div className="flex border-b border-border">
      <button
        type="button"
        onClick={() => setActiveTab("summary")}
        className={`px-4 py-2 text-sm font-medium transition-colors relative cursor-pointer ${
          activeTab === "summary"
            ? "text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary after:rounded-full"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        サマリー
      </button>
      <button
        type="button"
        onClick={() => setActiveTab("transactions")}
        className={`px-4 py-2 text-sm font-medium transition-colors relative cursor-pointer ${
          activeTab === "transactions"
            ? "text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary after:rounded-full"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        詳細一覧
      </button>
    </div>
  );
}

interface CFTabContentProps {
  summaryContent: ReactNode;
  transactionsContent: ReactNode;
}

export function CFTabContent({ summaryContent, transactionsContent }: CFTabContentProps) {
  const { activeTab } = useCFTab();
  return activeTab === "summary" ? summaryContent : transactionsContent;
}
