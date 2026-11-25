import type { AccountAlert } from "@asset-scraping/db";
import { describe, expect, it } from "vitest";
import { listUnresolvedWithdrawals } from "./account-alerts";

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

describe("listUnresolvedWithdrawals", () => {
  it("shortage 未定義だけを別枠に出す", () => {
    const unresolved = withdrawalAlert({ accountId: "card-2", shortage: undefined, note: "（引き落とし口座を解決できませんでした）" });
    const resolved = withdrawalAlert({ accountId: "card-1", withdrawalAccountId: "bank-1", shortage: 1 });
    expect(listUnresolvedWithdrawals([unresolved, resolved])).toEqual([unresolved]);
  });
});
