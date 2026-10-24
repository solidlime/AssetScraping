import type { AccountAlert } from "@asset-scraping/db";
import { describe, expect, it } from "vitest";
import { listUnresolvedWithdrawals, listWithdrawalShortages } from "./account-alerts";

function withdrawalAlert(over: Partial<AccountAlert>): AccountAlert {
  return {
    kind: "scheduled_withdrawal",
    accountId: "card-1",
    accountName: "三井住友カード",
    institution: "三井住友カード",
    balance: 30_000,
    status: "ok",
    scheduledWithdrawalAmount: 75_267,
    scheduledWithdrawalDate: "2025-01-10",
    ...over,
  };
}

describe("listWithdrawalShortages", () => {
  it("shortage 未定義（解決不能）の警告は不足額リストに入らない", () => {
    const alerts = [withdrawalAlert({ withdrawalAccountId: undefined, shortage: undefined })];
    expect(listWithdrawalShortages(alerts)).toEqual([]);
  });

  it("shortage 定義済みなら不足額リストに入る", () => {
    const alerts = [
      withdrawalAlert({ withdrawalAccountId: "bank-1", shortage: 45_267 }),
    ];
    expect(listWithdrawalShortages(alerts)).toEqual([
      { accountId: "bank-1", name: "三井住友カード", shortage: 45_267 },
    ]);
  });

  it("同一引き落とし口座を共有するカードは口座単位で1行にまとめる", () => {
    const alerts = [
      withdrawalAlert({ accountId: "card-1", withdrawalAccountId: "bank-1", shortage: 45_267 }),
      withdrawalAlert({ accountId: "card-2", withdrawalAccountId: "bank-1", shortage: 45_267 }),
    ];
    expect(listWithdrawalShortages(alerts)).toHaveLength(1);
  });

  it("解決不能と解決済みが混在しても、解決不能は不足額リストに混ざらない", () => {
    const alerts = [
      withdrawalAlert({ accountId: "card-1", withdrawalAccountId: "bank-1", shortage: 10_000 }),
      withdrawalAlert({ accountId: "card-2", withdrawalAccountId: undefined, shortage: undefined }),
    ];
    const rows = listWithdrawalShortages(alerts);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accountId).toBe("bank-1");
  });
});

describe("listUnresolvedWithdrawals", () => {
  it("shortage 未定義だけを別枠に出す", () => {
    const unresolved = withdrawalAlert({ accountId: "card-2", shortage: undefined, note: "（引き落とし口座を解決できませんでした）" });
    const resolved = withdrawalAlert({ accountId: "card-1", withdrawalAccountId: "bank-1", shortage: 1 });
    expect(listUnresolvedWithdrawals([unresolved, resolved])).toEqual([unresolved]);
  });
});
