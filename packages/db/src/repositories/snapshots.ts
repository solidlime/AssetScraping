import type { DbExecutor } from "../index.ts";
import { schema } from "../index.ts";
import type { RefreshResult } from "../types.ts";
import { now } from "../utils.ts";
import { ensureUnknownAccountId } from "./accounts.ts";

// 実行ごとに新しいスナップショットを作成（同じ日でも複数作成可能）
export function createSnapshot(
  db: DbExecutor,
  groupId: string,
  date: string,
  refreshResult?: RefreshResult | null,
  // 現行 schema 固有の必須列（本家には無い）
  account?: { accountId: string; balance: number },
): number {
  const result = db
    .insert(schema.dailySnapshots)
    .values({
      groupId,
      date,
      refreshCompleted: refreshResult?.completed ?? true,
      createdAt: now(),
      updatedAt: now(),
      accountId: account?.accountId ?? ensureUnknownAccountId(db),
      balance: account?.balance ?? 0,
    })
    .returning({ id: schema.dailySnapshots.id })
    .get();

  const snapshotId = result.id;

  return snapshotId;
}
