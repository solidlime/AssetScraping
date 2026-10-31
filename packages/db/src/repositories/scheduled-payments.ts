/**
 * scheduled_payments（家賃・電気代など「口座から落ちる定額の支払い」）リポジトリ。
 * ssnb からは取得できないため **手動登録専用**。書き込み側は crawler の /fixed-costs のみ
 * （web は proxy、mcp は read-only）。
 */
import { eq } from "drizzle-orm";
import type { Database } from "../client.ts";
import { accounts, scheduledPayments } from "../schema.ts";

export interface ScheduledPayment {
  id: string;
  name: string;
  amount: number;
  withdrawalDay: number;
  withdrawalAccountId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledPaymentInput {
  name: string;
  amount: number;
  withdrawalDay: number;
  withdrawalAccountId: string;
  isActive?: boolean;
}

/** 金額の上限（1件あたり1億円）。桁間違いの混入を止めるための天井 */
export const MAX_SCHEDULED_PAYMENT_AMOUNT = 100_000_000;
export const MAX_SCHEDULED_PAYMENT_NAME_LENGTH = 50;

/** 一覧。引き落とし日昇順 → 名称昇順（同日内で並びが揺れないように） */
export function listScheduledPayments(db: Database, opts: { activeOnly?: boolean } = {}): ScheduledPayment[] {
  const rows = db
    .select()
    .from(scheduledPayments)
    .orderBy(scheduledPayments.withdrawalDay, scheduledPayments.name)
    .all();
  return opts.activeOnly ? rows.filter((row) => row.isActive) : rows;
}

export function createScheduledPayment(db: Database, input: ScheduledPaymentInput): ScheduledPayment {
  const ts = new Date().toISOString();
  return db
    .insert(scheduledPayments)
    .values({
      id: crypto.randomUUID(),
      name: input.name,
      amount: input.amount,
      withdrawalDay: input.withdrawalDay,
      withdrawalAccountId: input.withdrawalAccountId,
      isActive: input.isActive ?? true,
      createdAt: ts,
      updatedAt: ts,
    })
    .returning()
    .get();
}

/** 更新。id が存在しなければ throw（crawler 側で 404 に変換する） */
export function updateScheduledPayment(db: Database, id: string, input: ScheduledPaymentInput): ScheduledPayment {
  const updated = db
    .update(scheduledPayments)
    .set({
      name: input.name,
      amount: input.amount,
      withdrawalDay: input.withdrawalDay,
      withdrawalAccountId: input.withdrawalAccountId,
      isActive: input.isActive ?? true,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(scheduledPayments.id, id))
    .returning()
    .get();
  if (!updated) throw new Error(`固定費が見つかりません: ${id}`);
  return updated;
}

/** 削除。削除できたら true、id が無ければ false */
export function deleteScheduledPayment(db: Database, id: string): boolean {
  return db.delete(scheduledPayments).where(eq(scheduledPayments.id, id)).run().changes > 0;
}

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

/**
 * 入力の検証（書込を伴わない）。異常は throw して 400 経路に乗せる。
 * DB を参照する唯一の理由は引き落とし口座の実在確認（category は問わない — 銀行以外から落ちる例がある）。
 */
export function validateScheduledPayment(db: Database, input: unknown): ScheduledPaymentInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("固定費の指定が不正です");
  }
  const raw = input as Record<string, unknown>;

  if (isBlank(raw.name)) throw new Error("固定費の名称を指定してください");
  const name = (raw.name as string).trim();
  if (name.length > MAX_SCHEDULED_PAYMENT_NAME_LENGTH) {
    throw new Error(`固定費の名称は ${MAX_SCHEDULED_PAYMENT_NAME_LENGTH} 文字以内で指定してください: ${name.length} 文字`);
  }

  const amount = raw.amount;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
    throw new Error(`金額は正の整数で指定してください: ${String(amount)}`);
  }
  if (amount > MAX_SCHEDULED_PAYMENT_AMOUNT) {
    throw new Error(`金額は ${MAX_SCHEDULED_PAYMENT_AMOUNT} 円以下で指定してください: ${amount}`);
  }

  const withdrawalDay = raw.withdrawalDay;
  if (typeof withdrawalDay !== "number" || !Number.isInteger(withdrawalDay) || withdrawalDay < 1 || withdrawalDay > 31) {
    throw new Error(`引き落とし日は 1〜31 の整数で指定してください: ${String(withdrawalDay)}`);
  }

  if (isBlank(raw.withdrawalAccountId)) throw new Error("引き落とし口座を指定してください");
  const withdrawalAccountId = raw.withdrawalAccountId as string;
  const exists = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, withdrawalAccountId))
    .get();
  if (!exists) throw new Error(`引き落とし口座が存在しません: ${withdrawalAccountId}`);

  if (raw.isActive !== undefined && typeof raw.isActive !== "boolean") {
    throw new Error("isActive は true / false で指定してください");
  }

  return { name, amount, withdrawalDay, withdrawalAccountId, isActive: raw.isActive ?? true };
}
