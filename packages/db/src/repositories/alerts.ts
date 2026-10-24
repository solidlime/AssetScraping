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
  /** scheduled_withdrawal のみ: 判定に使った引き落とし口座の残高 */
  balance: number;
  status: AccountStatusType;
  /** scheduled_withdrawal のみ: 引き落とし予定額（正値） */
  scheduledWithdrawalAmount?: number;
  /** scheduled_withdrawal のみ: 引き落とし予定日 (YYYY-MM-DD) */
  scheduledWithdrawalDate?: string;
  /** scheduled_withdrawal のみ: 不足額（予定額 - 判定に使った口座の残高） */
  shortage?: number;
  /** scheduled_withdrawal のみ: 判定に使った引き落とし口座の名称 */
  withdrawalAccountName?: string;
  /** scheduled_withdrawal のみ: 設定未投入など注意書き */
  note?: string;
}

const ALERT_STATUS_VALUES: ReadonlySet<AccountStatusType> = new Set<AccountStatusType>(["error", "updating", "suspended"]);

interface AlertRow {
  accountId: string;
  accountName: string;
  institution: string;
  balance: number;
  status: string | null;
  categoryName: string | null;
  /** accounts.category（"bank" / "card" 等）。本番 DB は category_id が未充填のためこちらで判定する */
  category: string;
  scheduledWithdrawalAmount: number | null;
  scheduledWithdrawalDate: string | null;
}

/** 期日までの日数（today より過去は負）。YYYY-MM-DD 同士の単純差分 */
function daysUntil(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * 引き落とし口座の解決結果。
 * "ambiguous"（未設定かつ銀行口座が複数）と "none" は判定不能なので警告しない。
 */
export interface WithdrawalAccountState {
  status: "set" | "single" | "ambiguous" | "none";
  accountId: string | null;
  accountName: string | null;
  balance: number | null;
}

/** 引き落とし予定を持つ行 or category="card" はクレカ。カード自身の負債残高を判定に混ぜない */
const isCardRow = (row: AlertRow): boolean =>
  row.scheduledWithdrawalAmount !== null || row.category === "card";

/** 銀行系口座か。カードは明示的に除外する */
function isBankRow(row: AlertRow): boolean {
  return !isCardRow(row) && (row.categoryName === "銀行" || row.category === "bank");
}

/**
 * 引き落とし口座を決める。明示指定が存在しない/カード行なら無視して自動解決に落とす
 * （MCP・API から任意の口座 ID を渡されて嘘の不足額を作られるのを防ぐ）
 */
function resolveWithdrawalAccount(rows: AlertRow[], withdrawalAccountId: string | null): WithdrawalAccountState {
  const configured = withdrawalAccountId
    ? rows.find((row) => row.accountId === withdrawalAccountId && !isCardRow(row))
    : undefined;
  if (configured) {
    return {
      status: "set",
      accountId: configured.accountId,
      accountName: configured.accountName,
      balance: configured.balance,
    };
  }
  const banks = rows.filter(isBankRow);
  const only = banks.length === 1 ? banks[0] : undefined;
  if (only) {
    return { status: "single", accountId: only.accountId, accountName: only.accountName, balance: only.balance };
  }
  return { status: banks.length === 0 ? "none" : "ambiguous", accountId: null, accountName: null, balance: null };
}

/**
 * F7: クレカの引き落とし予定額が引き落とし口座の残高を超え、かつ期日が N 日以内のものを返す。
 * 金額・期日のどちらかが欠けている口座は警告しない（誤警告より無警告）。
 * 引き落とし口座は設定 `withdrawal_account_id`、未設定なら銀行口座がちょうど1つの時だけそれを使う。
 */
function buildScheduledWithdrawalAlerts(
  rows: AlertRow[],
  opts: { alertDays: number; withdrawalAccountId: string | null; today: string },
): AccountAlert[] {
  const scheduled = rows.filter(
    (row) => row.scheduledWithdrawalAmount !== null && row.scheduledWithdrawalDate !== null,
  );
  if (scheduled.length === 0) return [];

  const source = resolveWithdrawalAccount(rows, opts.withdrawalAccountId);
  const available = source.balance;
  if (available === null || source.accountId === null) return [];
  // 口座名は warning 側の withdrawalAccountName / 本文で出す（ここで重ねて出さない）
  const note = source.status === "single" ? "（引き落とし口座が未設定のため自動判定）" : undefined;

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
      balance: available,
      status: toAccountStatusType(row.status),
      scheduledWithdrawalAmount: row.scheduledWithdrawalAmount as number,
      scheduledWithdrawalDate: row.scheduledWithdrawalDate as string,
      shortage: (row.scheduledWithdrawalAmount as number) - available,
      withdrawalAccountName: source.accountName ?? undefined,
      ...(note !== undefined ? { note } : {}),
    }));
}

/** 警告判定に使う口座×ステータスの平坦な行。本番 DB は category_id 未充填なので category も併用する */
function loadAlertRows(db: Database): AlertRow[] {
  return db
    .select({
      accountId: accounts.id,
      accountName: accounts.name,
      institution: accounts.institution,
      balance: accountStatuses.balance,
      status: accountStatuses.status,
      categoryName: institutionCategories.name,
      category: accounts.category,
      scheduledWithdrawalAmount: accountStatuses.scheduledWithdrawalAmount,
      scheduledWithdrawalDate: accountStatuses.scheduledWithdrawalDate,
    })
    .from(accounts)
    .innerJoin(accountStatuses, eq(accountStatuses.accountId, accounts.id))
    .leftJoin(institutionCategories, eq(institutionCategories.id, accounts.categoryId))
    .all()
    .map((row) => ({ ...row, balance: row.balance ?? 0 }));
}

/**
 * 引き落とし口座が決まっているかを返す（設定済み / 銀行1つで代用 / 未設定で判定不能）。
 * UI は "ambiguous"・"none" の時に「引き落とし口座が未設定です」を出す。
 */
export function getWithdrawalAccountState(
  db: Database,
  opts: { withdrawalAccountId?: string | null } = {},
): WithdrawalAccountState {
  const configured =
    opts.withdrawalAccountId !== undefined ? opts.withdrawalAccountId : getWithdrawalAccountId(db);
  return resolveWithdrawalAccount(loadAlertRows(db), configured);
}

/**
 * 警告リスト取得。threshold を省略すると DB 設定（低残高しきい値、既定 100_000）から読む。
 * ソート: low_balance 残高昇順（同一残高は accountId順） → account_status → scheduled_withdrawal 期日昇順。
 * 両方該当の口座は low_balance に統一する（重複返しはしない）。
 */
export function getAccountAlerts(
  db: Database,
  opts: { threshold?: number; withdrawalAlertDays?: number; withdrawalAccountId?: string | null; today?: string } = {},
): AccountAlert[] {
  const threshold = opts.threshold ?? getLowBalanceThreshold(db);
  const rows = loadAlertRows(db);

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
      if (x.kind === "scheduled_withdrawal" && y.kind === "scheduled_withdrawal") {
        const xd = x.scheduledWithdrawalDate ?? "";
        const yd = y.scheduledWithdrawalDate ?? "";
        if (xd !== yd) return xd < yd ? -1 : 1;
      }
      if (x.balance !== y.balance) return x.balance - y.balance;
      return x.accountId < y.accountId ? -1 : x.accountId > y.accountId ? 1 : 0;
    });
}
