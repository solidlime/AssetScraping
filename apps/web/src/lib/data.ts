import {
  createDb,
  getAllAccountStatuses,
  getAllAccounts,
  getAssetHistory,
  getHoldings,
  getLastScrapedAt,
  getMonthlySummary,
  getTransactions,
  resolveDbPath,
  type MonthlySummary,
} from "@asset-scraping/db";

/** web は read-only 接続。DB_PATH が file: URL の場合は ?mode=ro を付ける */
export function getDb() {
  const path = resolveDbPath();
  if (path.startsWith("file:")) {
    return createDb({ path: path.includes("?") ? path : `${path}?mode=ro` });
  }
  return createDb({ path, readOnly: true });
}

export interface DashboardData {
  accounts: ReturnType<typeof getAllAccounts>;
  statuses: ReturnType<typeof getAllAccountStatuses>;
  holdings: ReturnType<typeof getHoldings>;
  assetHistory: ReturnType<typeof getAssetHistory>;
  transactions: ReturnType<typeof getTransactions>;
  monthly: MonthlySummary[];
  lastScrapedAt: string | null;
}

export function loadDashboardData(): DashboardData {
  const db = getDb();
  try {
    return {
      accounts: getAllAccounts(db),
      statuses: getAllAccountStatuses(db),
      holdings: getHoldings(db),
      assetHistory: getAssetHistory(db),
      transactions: getTransactions(db, { limit: 200 }),
      monthly: getMonthlySummary(db, { months: 12 }),
      lastScrapedAt: getLastScrapedAt(db),
    };
  } finally {
    // SAFETY: drizzle の BetterSQLite3Database は $client に内部の better-sqlite3 インスタンスを保持する（型定義には無い）
    const client = (db as unknown as { $client: { close(): void } }).$client;
    client.close();
  }
}

export function formatYen(n: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(n);
}
