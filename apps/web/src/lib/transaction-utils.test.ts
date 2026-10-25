import { describe, expect, it } from "vitest";
import {
  filterTransactions,
  signedTransactionAmount,
  sortTransactions,
  UNCATEGORIZED,
  type Transaction,
} from "./transaction-utils";

function tx(overrides: Partial<Transaction> & Pick<Transaction, "id">): Transaction {
  return {
    date: "2026-10-01",
    category: null,
    subCategory: null,
    description: null,
    amount: 1_644,
    type: "expense",
    isTransfer: false,
    isExcludedFromCalculation: false,
    accountName: "テスト口座",
    ...overrides,
  };
}

const emptyFilters = {
  searchText: "",
  categories: [],
  types: [],
  accounts: [],
  date: null,
};

describe("UNCATEGORIZED", () => {
  it("SSNB と同じ「未分類」", () => {
    expect(UNCATEGORIZED).toBe("未分類");
  });
});

describe("filterTransactions", () => {
  it("category が null の行は「未分類」で検索にヒットする（振替ではない）", () => {
    const rows = [tx({ id: 1, category: null, description: "コンビニ" })];
    expect(filterTransactions(rows, { ...emptyFilters, searchText: "未分類" })).toHaveLength(1);
    expect(filterTransactions(rows, { ...emptyFilters, searchText: "振替" })).toHaveLength(0);
  });

  it("category が null の行は「未分類」でカテゴリ絞り込みできる", () => {
    const rows = [tx({ id: 1, category: null }), tx({ id: 2, category: "食費" })];
    expect(filterTransactions(rows, { ...emptyFilters, categories: ["未分類"] })).toHaveLength(1);
  });
});

describe("sortTransactions", () => {
  it("category が null の行は「未分類」として並ぶ", () => {
    const rows = [
      tx({ id: 1, category: "食費" }),
      tx({ id: 2, category: null }),
      tx({ id: 3, category: "衣類" }),
    ];
    const withNull = sortTransactions(rows, "category", "asc").map((t) => t.id);
    const explicit = sortTransactions(
      [rows[0], tx({ id: 2, category: UNCATEGORIZED }), rows[2]],
      "category",
      "asc",
    ).map((t) => t.id);
    // ロケール順に依存せず、null が「未分類」と同じ位置に来ることを見る
    expect(withNull).toEqual(explicit);
  });
});

describe("signedTransactionAmount", () => {
  it("expense は負値で表示する（DB は正値保存）", () => {
    expect(signedTransactionAmount({ amount: 1_644, type: "expense" })).toBe(-1_644);
  });

  it("income は正値のまま（符合なし表示）", () => {
    expect(signedTransactionAmount({ amount: 1_644, type: "income" })).toBe(1_644);
  });

  it("type が想定外でも金額を反転しない", () => {
    expect(signedTransactionAmount({ amount: 22_000, type: "transfer" })).toBe(22_000);
  });

  it("amount ソートは符号を復元した順序になる", () => {
    const rows = [
      tx({ id: 1, amount: 500, type: "income" }),
      tx({ id: 2, amount: 1_644, type: "expense" }),
      tx({ id: 3, amount: 100, type: "expense" }),
    ];
    expect(sortTransactions(rows, "amount", "asc").map((t) => t.id)).toEqual([2, 3, 1]);
  });
});
