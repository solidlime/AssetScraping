import type { AccountAlert } from "@asset-scraping/db";

/** 引き落とし口座を解決できなかった警告（残高不足バッジを出してはいけない） */
export function listUnresolvedWithdrawals(alerts: AccountAlert[]): AccountAlert[] {
  return alerts.filter(
    (a) => a.kind === "scheduled_withdrawal" && a.shortage === undefined,
  );
}
