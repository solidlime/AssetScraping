import { eq } from "drizzle-orm";
import type { Database } from "../client.ts";
import { accountStatuses, accounts } from "../schema.ts";
import { toAccountStatusType, type AccountStatusType } from "../types.ts";
import { getLowBalanceThreshold } from "./settings.ts";

/**
 * 口座警告（本家 bean・account-notifications-data.ts の相当物）。
 * 本家は「予測残高 <= しきい値」（月末日）だが、AssetScraping は
 * 口座一覧の現在残高が根拠のため **現在残高 <= しきい値** で判定する。
 * 加えてエラー系ステータス（error / updating / suspended）の口座を返す。
 */
export type AccountAlertKind = "low_balance" | "account_status";

export interface AccountAlert {
  kind: AccountAlertKind;
  accountId: string;
  accountName: string;
  institution: string;
  balance: number;
  status: AccountStatusType;
}

const ALERT_STATUS_VALUES: ReadonlySet<AccountStatusType> = new Set<AccountStatusType>(["error", "updating", "suspended"]);

interface AlertRow {
  accountId: string;
  accountName: string;
  institution: string;
  balance: number;
  status: string | null;
}

/**
 * 警告リスト取得。threshold を省略すると DB 設定（低残高しきい値、既定 100_000）から読む。
 * ソート: low_balance 残高昇順（同一残高は accountId順） → account_status。
 * 両方該当の口座は low_balance に統一する（重複返しはしない）。
 */
export function getAccountAlerts(
  db: Database,
  opts: { threshold?: number } = {},
): AccountAlert[] {
  const threshold = opts.threshold ?? getLowBalanceThreshold(db);
  const rows: AlertRow[] = db
    .select({
      accountId: accounts.id,
      accountName: accounts.name,
      institution: accounts.institution,
      balance: accountStatuses.balance,
      status: accountStatuses.status,
    })
    .from(accounts)
    .innerJoin(accountStatuses, eq(accountStatuses.accountId, accounts.id))
    .all()
    .map((row) => ({ ...row, balance: row.balance ?? 0 }));

  const normStatus = (value: string | null) => toAccountStatusType(value);

  const statusAlerts: AccountAlert[] = rows
    .filter((row) => ALERT_STATUS_VALUES.has(normStatus(row.status)))
    .map((row) => ({
      kind: "account_status" as const,
      accountId: row.accountId,
      accountName: row.accountName,
      institution: row.institution,
      balance: row.balance,
      status: normStatus(row.status),
    }));

  const lowBalanceAlerts: AccountAlert[] = rows
    .filter((row) => row.balance <= threshold)
    .map((row) => ({
      kind: "low_balance" as const,
      accountId: row.accountId,
      accountName: row.accountName,
      institution: row.institution,
      balance: row.balance,
      status: normStatus(row.status),
    }));

  // 両方該当の口座は low_balance を優先（status 警告に重複して載せない）
  const lowIds = new Set(lowBalanceAlerts.map((a) => a.accountId));
  const merged = [...lowBalanceAlerts, ...statusAlerts.filter((a) => !lowIds.has(a.accountId))];

  return merged
    .sort((x, y) => {
      const kindDiff = (x.kind === "low_balance" ? 0 : 1) - (y.kind === "low_balance" ? 0 : 1);
      if (kindDiff !== 0) return kindDiff;
      if (x.balance !== y.balance) return x.balance - y.balance;
      return x.accountId < y.accountId ? -1 : x.accountId > y.accountId ? 1 : 0;
    });
}
