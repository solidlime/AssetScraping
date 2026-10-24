import type { AccountAlert } from "@asset-scraping/db";

/** 不足額表示の1行（口座単位。同じ口座を共有するカードの不足額は同じ値が載る） */
export interface WithdrawalShortageRow {
  accountId: string;
  name: string;
  shortage: number;
}

/**
 * 口座単位の不足額リスト。**`shortage` 未定義の警告は入れない**。
 * shortage 未定義 = 引き落とし口座を解決できていない（note のみ）ので、
 * `shortage ?? 0` で拾うと「不足額 0円」という嘘の表示になる。
 * なお生成側（packages/db/src/repositories/alerts.ts）で `shortage > 0` は不変条件
 * （`total <= source.balance` の行は警告自体を作らない）。
 */
export function listWithdrawalShortages(
  alerts: AccountAlert[],
): WithdrawalShortageRow[] {
  const rows: WithdrawalShortageRow[] = [];
  const seen = new Set<string>();
  for (const alert of alerts) {
    if (alert.kind !== "scheduled_withdrawal") continue;
    if (alert.shortage === undefined) continue;
    const key = alert.withdrawalAccountId ?? alert.accountId;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      accountId: key,
      name: alert.withdrawalAccountName ?? alert.accountName,
      shortage: alert.shortage,
    });
  }
  return rows;
}

/** 引き落とし口座を解決できなかった警告（残高不足バッジを出してはいけない） */
export function listUnresolvedWithdrawals(alerts: AccountAlert[]): AccountAlert[] {
  return alerts.filter(
    (a) => a.kind === "scheduled_withdrawal" && a.shortage === undefined,
  );
}
