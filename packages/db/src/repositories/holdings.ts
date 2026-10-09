import { eq, and } from "drizzle-orm";
import type { DbExecutor } from "../index.ts";
import { schema } from "../index.ts";
import type { HoldingType } from "../types.ts";
import { now, upsertById } from "../utils.ts";

// 毎回新規作成（同じ銘柄でも別レコードとして保存）
export function createHolding(
  db: DbExecutor,
  accountId: string,
  name: string,
  type: HoldingType,
  options: {
    categoryId?: number | null;
    liabilityCategory?: string | null;
    code?: string | null;
    // 現行 schema 固有の必須列（本家には無い。評価額は holding_values 側が正だが、crawler 移植までの経過措置で必須）
    quantity: number;
    value: number;
    scrapedAt: string;
  },
): number {
  const result = db
    .insert(schema.holdings)
    .values({
      mfId: null,
      accountId,
      categoryId: options.categoryId ?? null,
      name,
      code: options.code ?? null,
      type,
      liabilityCategory: options.liabilityCategory ?? null,
      createdAt: now(),
      updatedAt: now(),
      isActive: true,
      quantity: options.quantity,
      value: options.value,
      scrapedAt: options.scrapedAt,
    })
    .returning({ id: schema.holdings.id })
    .get();

  return result.id;
}

export function saveHoldingValue(
  db: DbExecutor,
  holdingId: number,
  snapshotId: number,
  values: {
    amount: number;
    quantity?: number | null;
    unitPrice?: number | null;
    avgCostPrice?: number | null;
    dailyChange?: number | null;
    unrealizedGain?: number | null;
    unrealizedGainPct?: number | null;
  },
): void {
  const data = {
    holdingId,
    snapshotId,
    amount: values.amount,
    quantity: values.quantity ?? null,
    unitPrice: values.unitPrice ?? null,
    avgCostPrice: values.avgCostPrice ?? null,
    dailyChange: values.dailyChange ?? null,
    unrealizedGain: values.unrealizedGain ?? null,
    unrealizedGainPct: values.unrealizedGainPct ?? null,
  };

  upsertById(
    db,
    schema.holdingValues,
    and(
      eq(schema.holdingValues.holdingId, holdingId),
      eq(schema.holdingValues.snapshotId, snapshotId),
    )!,
    data,
    data,
  );
}
