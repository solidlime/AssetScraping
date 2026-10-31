import { eq } from "drizzle-orm";
import type { Database } from "../client.ts";
import { accountStatuses, accounts, institutionCategories } from "../schema.ts";
import { toAccountStatusType, type AccountStatusType } from "../types.ts";
import { todayJst } from "../repo.ts";
import {
  clampWithdrawalAlertDays,
  getLowBalanceThreshold,
  getWithdrawalAccountId,
  getWithdrawalAlertDays,
} from "./settings.ts";
import { listScheduledPayments, type ScheduledPayment } from "./scheduled-payments.ts";

/**
 * 口座警告（本家 bean・account-notifications-data.ts の相当物）。
 * 本家は「予測残高 <= しきい値」（月末日）だが、AssetScraping は
 * 口座一覧の現在残高が根拠のため **現在残高 <= しきい値** で判定する。
 * 加えてエラー系ステータス（error / updating / suspended）の口座を返す。
 */
export type AccountAlertKind = "low_balance" | "account_status" | "scheduled_withdrawal" | "scheduled_payment";

export interface AccountAlert {
  kind: AccountAlertKind;
  accountId: string;
  accountName: string;
  institution: string;
  /** scheduled_withdrawal のみ: 判定に使った引き落とし口座の残高 */
  balance: number;
  status: AccountStatusType;
  /** scheduled_withdrawal / scheduled_payment のみ: 引き落とし予定額（正値） */
  scheduledWithdrawalAmount?: number;
  /** scheduled_withdrawal / scheduled_payment のみ: 引き落とし予定日 (YYYY-MM-DD) */
  scheduledWithdrawalDate?: string;
  /** scheduled_payment のみ: 固定費の名称 */
  paymentName?: string;
  /**
   * scheduled_withdrawal / scheduled_payment のみ: 不足額 **（口座単位）**。
   * 判定はカード予定と固定費の合算額で行うので、同じ口座を共有する警告には同じ値が載る。
   * 同一口座を共有する複数カードには同じ値が載るので、UI 側でカード単位に合算すると倍になる。
   */
  shortage?: number;
  /** scheduled_withdrawal / scheduled_payment のみ: 判定に使った引き落とし口座の名称 */
  withdrawalAccountName?: string;
  /** scheduled_withdrawal / scheduled_payment のみ: 解決先の引き落とし口座 ID（解決不能なら未設定） */
  withdrawalAccountId?: string;
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
  /** カード行の引き落とし口座リンク（手動設定専用。null ならグローバル設定で解決） */
  withdrawalAccountId: string | null;
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

/**
 * low_balance（残高不足警告）の対象外カテゴリ。
 * card は残高が「利用可能枠/0」、securities は「現金残高」、pension は評価額で、いずれも
 * 銀行口座の残高不足とは意味が違うため一律しきい値で警告しない。
 */
const LOW_BALANCE_EXCLUDED_CATEGORIES: ReadonlySet<string> = new Set(["card", "securities", "pension"]);

/**
 * 銀行系口座（引き落とし口座の候補）かの判定。web（設定画面）と共有する唯一の述語。
 * カードは category="card" で必ず除外する。
 */
export function isBankLikeAccount(a: { category: string; categoryName?: string | null }): boolean {
  return a.category !== "card" && (a.categoryName === "銀行" || a.category === "bank");
}

/** 銀行系口座か。カードは明示的に除外する */
function isBankRow(row: AlertRow): boolean {
  return !isCardRow(row) && isBankLikeAccount(row);
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

const AUTO_NOTE = "（引き落とし口座が未設定のため自動判定）";
const UNRESOLVED_NOTE = "（引き落とし口座を解決できませんでした）";

/**
 * F7: クレカの引き落とし予定額が引き落とし口座の残高を超え、かつ期日が N 日以内のものを返す。
 * 金額・期日のどちらかが欠けている口座は警告しない（誤警告より無警告）。
 * 引き落とし口座はカード行の `withdrawal_account_id`、無ければ設定 `withdrawal_account_id`、
 * 未設定なら銀行口座がちょうど1つの時だけそれを使う。
 * 不足判定は解決先口座単位（合算）、返す警告はカード単位。
 */

/** カード行 1 枚の解決先（解決できなければ null） */
interface ResolvedSource {
  accountId: string;
  accountName: string;
  balance: number;
}

/**
 * カード行の引き落とし口座を決める。
 * 1. カード行にリンクがあればその口座（存在しない/カード行を指すなら解決不能。グローバルへは落とさない）
 * 2. リンクが無ければグローバル設定 → 銀行 1 つ → none/ambiguous の順（現行踏襲）
 */
function resolveCardSource(
  row: AlertRow,
  rows: AlertRow[],
  fallback: WithdrawalAccountState,
): { source: ResolvedSource | null; note?: string } {
  if (row.withdrawalAccountId !== null) {
    const target = rows.find((r) => r.accountId === row.withdrawalAccountId);
    if (!target || isCardRow(target)) return { source: null, note: UNRESOLVED_NOTE };
    return {
      source: { accountId: target.accountId, accountName: target.accountName, balance: target.balance },
    };
  }
  if ((fallback.status === "set" || fallback.status === "single") && fallback.accountId !== null) {
    return {
      source: {
        accountId: fallback.accountId,
        accountName: fallback.accountName ?? "",
        balance: fallback.balance ?? 0,
      },
      ...(fallback.status === "single" ? { note: AUTO_NOTE } : {}),
    };
  }
  return { source: null };
}

/** 窓内の1行とその解決先 */
interface ResolvedWithdrawalRow {
  row: AlertRow;
  source: ResolvedSource | null;
  note?: string;
}

/**
 * 窓内（today から alertDays 日以内）の引き落とし予定行を抽出し、カード別リンク→グローバル既定の順で
 * 引き落とし口座を解決して、解決先口座ごとの合算額を返す。警告（不足時のみ）と予定一覧（常時）で共有する。
 * 窓内に行が無ければ null。
 */
function resolveWithdrawalWindow(
  rows: AlertRow[],
  opts: { alertDays: number; withdrawalAccountId: string | null; today: string },
): { resolved: ResolvedWithdrawalRow[]; totals: Map<string, number> } | null {
  const inWindow = rows.filter((row) => {
    if (row.scheduledWithdrawalAmount === null || row.scheduledWithdrawalDate === null) return false;
    const remaining = daysUntil(opts.today, row.scheduledWithdrawalDate);
    return remaining >= 0 && remaining <= opts.alertDays;
  });
  if (inWindow.length === 0) return null;

  const fallback = resolveWithdrawalAccount(rows, opts.withdrawalAccountId);
  const resolved = inWindow.map((row) => ({
    row,
    ...resolveCardSource(row, rows, fallback),
  }));

  // 判定は「解決先口座ごとに合算」— 同一口座を共有するカードの予定額を足してから残高と比べる。
  // 合算対象は**窓内（opts.alertDays 日以内）に引き落とされる予定のみ**（窓外の予定は足さない）
  const totals = new Map<string, number>();
  for (const { row, source } of resolved) {
    if (!source) continue;
    totals.set(source.accountId, (totals.get(source.accountId) ?? 0) + (row.scheduledWithdrawalAmount as number));
  }

  return { resolved, totals };
}

function buildScheduledWithdrawalAlerts(
  rows: AlertRow[],
  opts: { alertDays: number; withdrawalAccountId: string | null; today: string },
): AccountAlert[] {
  const window = resolveWithdrawalWindow(rows, opts);
  if (window === null) return [];
  const { resolved, totals } = window;

  const alerts: AccountAlert[] = [];
  for (const { row, source, note } of resolved) {
    const base = {
      kind: "scheduled_withdrawal" as const,
      accountId: row.accountId,
      accountName: row.accountName,
      institution: row.institution,
      status: toAccountStatusType(row.status),
      scheduledWithdrawalAmount: row.scheduledWithdrawalAmount as number,
      scheduledWithdrawalDate: row.scheduledWithdrawalDate as string,
    };
    if (!source) {
      // 解決不能: 不足判定はしない（短額を捏造しない）。残高欄はカード行自身の値
      if (note === undefined) continue; // グローバル設定未解決（none/ambiguous）は現行どおり黙る
      alerts.push({ ...base, balance: row.balance, note });
      continue;
    }
    const total = totals.get(source.accountId) ?? 0;
    if (total <= source.balance) continue;
    alerts.push({
      ...base,
      balance: source.balance,
      // 口座単位の不足額（共有カードには同じ値が載る）
      shortage: total - source.balance,
      withdrawalAccountName: source.accountName || undefined,
      withdrawalAccountId: source.accountId,
      ...(note !== undefined ? { note } : {}),
    });
  }
  return alerts;
}

/** その月の日数（月末丸め用）。month は 1-12 */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * withdrawalDay(1-31) から today 以降で最も近い引き落とし日を返す。
 * その月に無い日（31日等）は月末に丸める。today と同じ日は当月扱い。
 * 例: (27, "2026-10-25") → "2026-10-27" / (15, "2026-10-25") → "2026-11-15"
 */
function nextWithdrawalDate(day: number, today: string): string {
  const [year, month] = today.split("-").map(Number) as [number, number];
  const ymd = (y: number, m: number) =>
    `${y}-${String(m).padStart(2, "0")}-${String(Math.min(day, daysInMonth(y, m))).padStart(2, "0")}`;
  const thisMonth = ymd(year, month);
  if (thisMonth >= today) return thisMonth;
  return month === 12 ? ymd(year + 1, 1) : ymd(year, month + 1);
}

/**
 * 窓内（today から alertDays 日以内）の固定費と、口座単位の合算額。
 * 合算額は**カード引き落とし予定の合算に固定費を足したもの** — 同じ口座からカードと固定費が
 * 落ちる場合に残高を2回使ってはいけないため。カード側の窓内合算は resolveWithdrawalWindow と共有する。
 */
function resolveScheduledPaymentWindow(
  rows: AlertRow[],
  payments: ScheduledPayment[],
  opts: { alertDays: number; withdrawalAccountId: string | null; today: string },
): { inWindow: { payment: ScheduledPayment; date: string }[]; totals: Map<string, number> } {
  const inWindow = payments
    .filter((payment) => payment.isActive)
    .map((payment) => ({ payment, date: nextWithdrawalDate(payment.withdrawalDay, opts.today) }))
    .filter(({ date }) => {
      const remaining = daysUntil(opts.today, date);
      return remaining >= 0 && remaining <= opts.alertDays;
    });

  const totals = new Map(resolveWithdrawalWindow(rows, opts)?.totals ?? []);
  for (const { payment } of inWindow) {
    const key = payment.withdrawalAccountId;
    totals.set(key, (totals.get(key) ?? 0) + payment.amount);
  }
  return { inWindow, totals };
}

/**
 * 固定費の残高不足警告。口座単位の合算額が残高を超える場合のみ、窓内の固定費1件ごとに1警告を出す。
 * 引き落とし元口座の行が無い（残高不明）場合は判定せずスキップする（不足額を捏造しない）。
 */
function buildScheduledPaymentAlerts(
  rows: AlertRow[],
  payments: ScheduledPayment[],
  opts: { alertDays: number; withdrawalAccountId: string | null; today: string },
): AccountAlert[] {
  const { inWindow, totals } = resolveScheduledPaymentWindow(rows, payments, opts);

  const alerts: AccountAlert[] = [];
  for (const { payment, date } of inWindow) {
    const row = rows.find((r) => r.accountId === payment.withdrawalAccountId);
    if (!row) continue;
    const total = totals.get(payment.withdrawalAccountId) ?? 0;
    if (total <= row.balance) continue;
    alerts.push({
      kind: "scheduled_payment",
      // 警告は引き落とし元口座に出す（固定費自体は口座ではないため）
      accountId: row.accountId,
      accountName: row.accountName,
      institution: row.institution,
      balance: row.balance,
      status: toAccountStatusType(row.status),
      scheduledWithdrawalAmount: payment.amount,
      scheduledWithdrawalDate: date,
      paymentName: payment.name,
      // 口座単位の不足額（同じ口座を共有する警告には同じ値が載る。UI 側で dedupe する前提）
      shortage: total - row.balance,
      withdrawalAccountName: row.accountName || undefined,
      withdrawalAccountId: row.accountId,
    });
  }
  return alerts;
}

/** ダッシュボード表示用: 窓内の引き落とし予定1件 */
export interface UpcomingWithdrawal {
  accountId: string;
  accountName: string;
  institution: string;
  amount: number;
  /** 引き落とし予定日 (YYYY-MM-DD) */
  date: string;
  remainingDays: number;
  /** 引き落とし元口座（解決できなければ undefined） */
  withdrawalAccountName?: string;
  withdrawalAccountId?: string;
  /** 解決できた場合のみ: 引き落とし元口座の残高 */
  balance?: number;
  /** 解決できた場合のみ: 口座単位の合算不足額（不足が無ければ undefined） */
  shortage?: number;
  /** "card" = クレカの引き落とし予定 / "payment" = 固定費（既定は "card"） */
  kind?: "card" | "payment";
  /** 固定費のみ: 固定費の名称 */
  paymentName?: string;
  note?: string;
}

/**
 * 窓内（alertDays 日以内）の引き落とし予定一覧（クレカ + 固定費）。**不足していなくても返す**。
 * /accounts の警告（不足時のみ）とは別に、ダッシュボードで予定を見せる用途。
 * 並び: 期日昇順 → 金額降順 → accountId 昇順（種別では分けない）。
 */
export function getUpcomingWithdrawals(
  db: Database,
  opts: { withdrawalAlertDays?: number; withdrawalAccountId?: string | null; today?: string } = {},
): UpcomingWithdrawal[] {
  const today = opts.today ?? todayJst();
  const alertOpts = {
    alertDays: clampWithdrawalAlertDays(opts.withdrawalAlertDays ?? getWithdrawalAlertDays(db)),
    withdrawalAccountId:
      opts.withdrawalAccountId !== undefined ? opts.withdrawalAccountId : getWithdrawalAccountId(db),
    today,
  };
  const rows = loadAlertRows(db);
  const window = resolveWithdrawalWindow(rows, alertOpts);

  const cardUpcoming = (window?.resolved ?? []).map(({ row, source, note }): UpcomingWithdrawal => {
    const date = row.scheduledWithdrawalDate as string;
    const base = {
      accountId: row.accountId,
      accountName: row.accountName,
      institution: row.institution,
      amount: row.scheduledWithdrawalAmount as number,
      date,
      remainingDays: daysUntil(today, date),
    };
    if (!source) return { ...base, ...(note !== undefined ? { note } : {}) };
    const total = window?.totals.get(source.accountId) ?? 0;
    return {
      ...base,
      withdrawalAccountName: source.accountName || undefined,
      withdrawalAccountId: source.accountId,
      balance: source.balance,
      ...(total > source.balance ? { shortage: total - source.balance } : {}),
      ...(note !== undefined ? { note } : {}),
    };
  });

  // 固定費は口座ではないので accountId には固定費自身の ID を入れ、表示名は paymentName で渡す
  const { inWindow: paymentsInWindow, totals: paymentTotals } = resolveScheduledPaymentWindow(
    rows,
    listScheduledPayments(db, { activeOnly: true }),
    alertOpts,
  );
  const paymentUpcoming = paymentsInWindow.map(({ payment, date }): UpcomingWithdrawal => {
    const source = rows.find((r) => r.accountId === payment.withdrawalAccountId);
    const total = paymentTotals.get(payment.withdrawalAccountId) ?? 0;
    return {
      kind: "payment",
      accountId: payment.id,
      accountName: payment.name,
      paymentName: payment.name,
      institution: source?.institution ?? "",
      amount: payment.amount,
      date,
      remainingDays: daysUntil(today, date),
      withdrawalAccountName: source?.accountName || undefined,
      withdrawalAccountId: payment.withdrawalAccountId,
      ...(source ? { balance: source.balance } : {}),
      ...(source && total > source.balance ? { shortage: total - source.balance } : {}),
    };
  });

  return [...cardUpcoming, ...paymentUpcoming].sort((x, y) => {
    if (x.date !== y.date) return x.date < y.date ? -1 : 1;
    if (x.amount !== y.amount) return y.amount - x.amount;
    return x.accountId < y.accountId ? -1 : x.accountId > y.accountId ? 1 : 0;
  });
}

/**
 * カード別リンクでも既定でも引き落とし口座を解決できないカードの件数。
 * 既定が未決（ambiguous/none）でも全カードが個別リンクで解決できるなら
 * 「未設定」警告は不要 — web の /accounts の表示条件に使う。
 * 比較対象（予定額・期日）を持たないカードは数えない（実際には警告対象にならないため）。
 * loadAlertRows は accountStatuses に INNER JOIN するので、ステータス行が無いカードはそもそも対象外（無警告側に倒れる）。
 */
export function countUnresolvedCards(db: Database): number {
  const rows = loadAlertRows(db);
  const fallback = resolveWithdrawalAccount(rows, getWithdrawalAccountId(db));
  return rows.filter(
    (row) =>
      isCardRow(row) &&
      row.scheduledWithdrawalAmount !== null &&
      row.scheduledWithdrawalDate !== null &&
      resolveCardSource(row, rows, fallback).source === null,
  ).length;
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
      withdrawalAccountId: accounts.withdrawalAccountId,
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
 * ソート: low_balance 残高昇順（同一残高は accountId順） → account_status →
 *       scheduled_withdrawal / scheduled_payment（同じ枠で期日昇順）。
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
    .filter((row) => !LOW_BALANCE_EXCLUDED_CATEGORIES.has(row.category) && row.balance <= threshold)
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

  const withdrawalOpts = {
    // opts 経路も DB 経路と同じ 1 本のクランプを通す（0/負/NaN で警告ゼロが無言成立するのを防ぐ）
    alertDays: clampWithdrawalAlertDays(opts.withdrawalAlertDays ?? getWithdrawalAlertDays(db)),
    withdrawalAccountId:
      opts.withdrawalAccountId !== undefined ? opts.withdrawalAccountId : getWithdrawalAccountId(db),
    today: opts.today ?? todayJst(),
  };
  const withdrawalAlerts = buildScheduledWithdrawalAlerts(rows, withdrawalOpts);
  // 固定費はカード予定と同じ口座で合算してから不足判定する（残高を2回使わない）
  const paymentAlerts = buildScheduledPaymentAlerts(rows, listScheduledPayments(db), withdrawalOpts);

  return [...merged, ...withdrawalAlerts, ...paymentAlerts]
    .sort((x, y) => {
      const rank = (a: AccountAlert) =>
        a.kind === "low_balance" ? 0 : a.kind === "account_status" ? 1 : 2;
      const kindDiff = rank(x) - rank(y);
      if (kindDiff !== 0) return kindDiff;
      // カード引き落としと固定費は同じ枠に混ぜて期日昇順
      const dated = (a: AccountAlert) => a.kind === "scheduled_withdrawal" || a.kind === "scheduled_payment";
      if (dated(x) && dated(y)) {
        const xd = x.scheduledWithdrawalDate ?? "";
        const yd = y.scheduledWithdrawalDate ?? "";
        if (xd !== yd) return xd < yd ? -1 : 1;
      }
      if (x.balance !== y.balance) return x.balance - y.balance;
      return x.accountId < y.accountId ? -1 : x.accountId > y.accountId ? 1 : 0;
    });
}
