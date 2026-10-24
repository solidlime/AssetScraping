import { eq } from "drizzle-orm";
import type { Database } from "../client.ts";
import { accountStatuses, accounts, institutionCategories } from "../schema.ts";
import { toAccountStatusType, type AccountStatusType } from "../types.ts";
import { todayJst } from "../repo.ts";
import { getLowBalanceThreshold, getWithdrawalAccountId, getWithdrawalAlertDays } from "./settings.ts";

/**
 * 口座警告（本家 bean・account-notifications-data.ts の相当物）。
 * 本家は「予測残高 <= しきい値」（月末日）だが、AssetScraping は
 * 口座一覧の現在残高が根拠のため **現在残高 <= しきい値** で判定する。
 * 加えてエラー系ステータス（error / updating / suspended）の口座を返す。
 */
export type AccountAlertKind = "low_balance" | "account_status" | "scheduled_withdrawal";

export interface AccountAlert {
  kind: AccountAlertKind;
  accountId: string;
  accountName: string;
  institution: string;
  balance: number;
  status: AccountStatusType;
  /** scheduled_withdrawal のみ: 引き落とし予定額（正値） */
  scheduledWithdrawalAmount?: number;
  /** scheduled_withdrawal のみ: 引き落とし予定日 (YYYY-MM-DD) */
  scheduledWithdrawalDate?: string;
  /** scheduled_withdrawal のみ: 不足額（予定額 - 引き落とし口座残高） */
  shortage?: number;
}

const ALERT_STATUS_VALUES: ReadonlySet<AccountStatusType> = new Set<AccountStatusType>(["error", "updating", "suspended"]);

interface AlertRow {
  accountId: string;
  accountName: string;
  institution: string;
  balance: number;
  status: string | null;
  categoryName: string | null;
  scheduledWithdrawalAmount: number | null;
  scheduledWithdrawalDate: string | null;
}

/** 期日までの日数（today より過去は負）。YYYY-MM-DD 同士の単純差分 */
function daysUntil(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * F7: クレカの引き落とし予定額が引き落とし口座の残高を超え、かつ期日が N 日以内のものを返す。
 * 金額・期日のどちらかが欠けている口座は警告しない（誤警告より無警告）。
 * 引き落とし口座は設定 `withdrawal_account_id` の口座、未設定なら銀行カテゴリ残高の合計。
 */
function buildScheduledWithdrawalAlerts(
  rows: AlertRow[],
  opts: { alertDays: number; withdrawalAccountId: string | null; today: string },
): AccountAlert[] {
  const scheduled = rows.filter(
    (row) => row.scheduledWithdrawalAmount !== null && row.scheduledWithdrawalDate !== null,
  );
  if (scheduled.length === 0) return [];

  const available = opts.withdrawalAccountId
    ? (rows.find((row) => row.accountId === opts.withdrawalAccountId)?.balance ?? null)
    : rows.filter((row) => row.categoryName === "銀行").reduce((sum, row) => sum + row.balance, 0);
  if (available === null) return [];

  return scheduled
    .filter((row) => {
      const amount = row.scheduledWithdrawalAmount as number;
      const date = row.scheduledWithdrawalDate as string;
      const remaining = daysUntil(opts.today, date);
      return amount > available && remaining >= 0 && remaining <= opts.alertDays;
    })
    .map((row) => ({
      kind: "scheduled_withdrawal" as const,
      accountId: row.accountId,
      accountName: row.accountName,
      institution: row.institution,
      balance: row.balance,
      status: toAccountStatusType(row.status),
      scheduledWithdrawalAmount: row.scheduledWithdrawalAmount as number,
      scheduledWithdrawalDate: row.scheduledWithdrawalDate as string,
      shortage: (row.scheduledWithdrawalAmount as number) - available,
    }));
}

/**
 * 警告リスト取得。threshold を省略すると DB 設定（低残高しきい値、既定 100_000）から読む。
 * ソート: low_balance 残高昇順（同一残高は accountId順） → account_status。
 * 両方該当の口座は low_balance に統一する（重複返しはしない）。
 */
export function getAccountAlerts(
  db: Database,
  opts: { threshold?: number; withdrawalAlertDays?: number; withdrawalAccountId?: string | null; today?: string } = {},
): AccountAlert[] {
  const threshold = opts.threshold ?? getLowBalanceThreshold(db);
  const rows: AlertRow[] = db
    .select({
      accountId: accounts.id,
      accountName: accounts.name,
      institution: accounts.institution,
      balance: accountStatuses.balance,
      status: accountStatuses.status,
      categoryName: institutionCategories.name,
      scheduledWithdrawalAmount: accountStatuses.scheduledWithdrawalAmount,
      scheduledWithdrawalDate: accountStatuses.scheduledWithdrawalDate,
    })
    .from(accounts)
    .innerJoin(accountStatuses, eq(accountStatuses.accountId, accounts.id))
    .leftJoin(institutionCategories, eq(institutionCategories.id, accounts.categoryId))
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

  const withdrawalAlerts = buildScheduledWithdrawalAlerts(rows, {
    alertDays: opts.withdrawalAlertDays ?? getWithdrawalAlertDays(db),
    withdrawalAccountId:
      opts.withdrawalAccountId !== undefined ? opts.withdrawalAccountId : getWithdrawalAccountId(db),
    today: opts.today ?? todayJst(),
  });

  return [...merged, ...withdrawalAlerts]
    .sort((x, y) => {
      const rank = (a: AccountAlert) =>
        a.kind === "low_balance" ? 0 : a.kind === "account_status" ? 1 : 2;
      const kindDiff = rank(x) - rank(y);
      if (kindDiff !== 0) return kindDiff;
      if (x.balance !== y.balance) return x.balance - y.balance;
      return x.accountId < y.accountId ? -1 : x.accountId > y.accountId ? 1 : 0;
    });
}
