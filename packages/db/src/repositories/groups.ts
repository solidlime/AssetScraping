import { eq, notInArray } from "drizzle-orm";
import type { Db, DbExecutor } from "../index.ts";
import { schema } from "../index.ts";
import type { Group } from "../types.ts";
import { now, upsertById } from "../utils.ts";

export function getCurrentGroupId(db: Db): string | null {
  const group = db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.isCurrent, true))
    .get();
  return group?.id ?? null;
}

export function clearGroupAccountLinks(db: DbExecutor, groupId: string): void {
  db.delete(schema.groupAccounts).where(eq(schema.groupAccounts.groupId, groupId)).run();
}

export function linkAccountToGroup(
  db: Db,
  groupId: string,
  accountId: string,
): void {
  db
    .insert(schema.groupAccounts)
    .values({
      groupId,
      accountId,
      createdAt: now(),
      updatedAt: now(),
    })
    .onConflictDoNothing()
    .run();
}

export function upsertGroup(db: DbExecutor, group: Group): void {
  // isCurrent=trueの場合のみ、他のグループをfalseにする
  if (group.isCurrent) {
    db.update(schema.groups).set({ isCurrent: false, updatedAt: now() }).run();
  }

  // グループをupsert
  upsertById(
    db,
    schema.groups,
    eq(schema.groups.id, group.id),
    {
      id: group.id,
      name: group.name,
      isCurrent: group.isCurrent,
    },
    {
      name: group.name,
      isCurrent: group.isCurrent,
    },
  );
}

export function updateGroupLastScrapedAt(
  db: DbExecutor,
  groupId: string,
  timestamp: string,
): void {
  db
    .update(schema.groups)
    .set({ lastScrapedAt: timestamp, updatedAt: now() })
    .where(eq(schema.groups.id, groupId))
    .run();
}

export function deleteGroupsNotIn(db: DbExecutor, groupIds: string[]): void {
  if (groupIds.length === 0) return;
  db.delete(schema.groups).where(notInArray(schema.groups.id, groupIds)).run();
}

/**
 * 複数アカウントリンクの一括insert
 */
export function linkAccountsToGroup(
  db: DbExecutor,
  groupId: string,
  accountIds: string[],
): void {
  if (accountIds.length === 0) return;

  const timestamp = now();
  const records = accountIds.map((accountId) => ({
    groupId,
    accountId,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));

  db.insert(schema.groupAccounts).values(records).onConflictDoNothing().run();
}
