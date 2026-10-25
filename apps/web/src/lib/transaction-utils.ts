/** SSNB が大項目・中項目に明示的に「未分類」と表示した行の語彙。
 * SSNB の空セルは空のまま表示する（null をこれに潰すと元データと乖離する）。 */
export const UNCATEGORIZED = "未分類";

/**
 * 金額の符号を type から復元する。DB は常に正値（abs）で保存し、収支は type で持つ
 * （packages/db/src/repo.ts の upsertTransactions）。SSNB は支出を負値で表示する。
 */
export function signedTransactionAmount(transaction: { amount: number; type: string }): number {
  return transaction.type === "expense" ? -transaction.amount : transaction.amount;
}

export function countBy<T>(items: T[], keyFn: (item: T) => string): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

export interface TransactionFilters {
  searchText: string;
  categories: string[];
  types: string[];
  accounts: string[];
  date: string | null;
}

export function filterTransactionsByYear(
  transactions: Transaction[],
  year: string | null,
): Transaction[] {
  if (!year) return transactions;
  return transactions.filter((transaction) => transaction.date.startsWith(`${year}-`));
}

export function filterTransactions(
  transactions: Transaction[],
  filters: TransactionFilters,
): Transaction[] {
  return transactions.filter((t) => {
    if (filters.searchText) {
      const search = filters.searchText.toLowerCase();
      const matchDesc = t.description?.toLowerCase().includes(search);
      const matchCat = (t.category ?? UNCATEGORIZED).toLowerCase().includes(search);
      if (!matchDesc && !matchCat) return false;
    }

    const category = t.category ?? UNCATEGORIZED;
    if (filters.categories.length > 0 && !filters.categories.includes(category)) {
      return false;
    }

    if (filters.types.length > 0 && !filters.types.includes(t.type)) {
      return false;
    }

    const account = t.accountName ?? "不明";
    if (filters.accounts.length > 0 && !filters.accounts.includes(account)) {
      return false;
    }

    if (filters.date && t.date !== filters.date) {
      return false;
    }

    return true;
  });
}

const SORT_FUNCTIONS: Record<SortColumn, (a: Transaction, b: Transaction) => number> = {
  date: (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  description: (a, b) => (a.description ?? "").localeCompare(b.description ?? ""),
  category: (a, b) =>
    (a.category ?? UNCATEGORIZED).localeCompare(b.category ?? UNCATEGORIZED),
  type: (a, b) => a.type.localeCompare(b.type),
  amount: (a, b) => signedTransactionAmount(a) - signedTransactionAmount(b),
  accountName: (a, b) => (a.accountName ?? "").localeCompare(b.accountName ?? ""),
};

export function sortTransactions(
  transactions: Transaction[],
  column: SortColumn,
  direction: "asc" | "desc",
): Transaction[] {
  const sorted = [...transactions].sort(SORT_FUNCTIONS[column]);
  return direction === "desc" ? sorted.reverse() : sorted;
}

export interface Transaction {
  id: number;
  date: string;
  category: string | null;
  subCategory: string | null;
  description: string | null;
  amount: number;
  type: string;
  isTransfer: boolean | null;
  isExcludedFromCalculation: boolean | null;
  accountName: string | null;
}

export type SortColumn = "date" | "description" | "category" | "type" | "amount" | "accountName";
