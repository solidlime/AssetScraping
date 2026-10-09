import { eq, sql } from "drizzle-orm";
import type { Db, DbExecutor } from "../index.ts";
import { schema } from "../index.ts";
import type { AccountStatus } from "../types.ts";
import { now, convertToIsoDate, upsertById } from "../utils.ts";
import { getOrCreateInstitutionCategory } from "./institution-categories.ts";

const BATCH_SIZE = 500;

// 本家との差分: accounts.id が integer autoincrement ではなく text（ssnb 口座 ID）。
// そのため account id を渡す箇所は全て string、buildAccountIdMap の値も string。

export function upsertAccount(db: Db, account: AccountStatus): string {
  // URLからmfIdを抽出（例: /accounts/show/0T1oiWJN9GM... -> 0T1oiWJN9GM...）
  const mfId = account.mfId || account.name;

  const ts = now();
  return upsertById<{ id: string }>(
    db,
    schema.accounts,
    eq(schema.accounts.mfId, mfId),
    {
      mfId,
      id: mfId,
      name: account.name,
      type: account.type,
      institution: account.name,
      // 現行 schema 固有の必須列（本家には無い）
      category: "other",
      balance: 0,
      scrapedAt: ts,
      isActive: true,
    },
    {
      name: account.name,
      type: account.type,
      isActive: true,
    },
  );
}

export function saveAccountStatus(
  db: Db,
  accountId: string,
  status: AccountStatus,
): void {
  // lastUpdated を ISO形式に変換
  const isoLastUpdated = convertToIsoDate(status.lastUpdated);

  const data = {
    accountId,
    status: status.status,
    lastUpdated: isoLastUpdated,
    totalAssets: status.totalAssets ?? 0,
    errorMessage: status.errorMessage ?? null,
    // 現行 schema 固有の必須列（本家には無い）
    balance: status.totalAssets ?? 0,
    scrapedAt: isoLastUpdated,
  };

  upsertById(
    db,
    schema.accountStatuses,
    eq(schema.accountStatuses.accountId, accountId),
    data,
    data,
  );
}

/**
 * 未解決アカウント用のフォールバック口座（本家 save-scraped-data と同じ
 * mfId="unknown" の暗黙口座）。存在しなければ作成して id を返す。
 */
export function ensureUnknownAccountId(db: DbExecutor): string {
  const existing = db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(eq(schema.accounts.mfId, "unknown"))
    .get();
  if (existing) return existing.id;

  const ts = now();
  upsertAccount(db, {
    mfId: "unknown",
    name: "-",
    type: "手動",
    status: "unknown",
    lastUpdated: "",
    url: "",
    totalAssets: 0,
  });
  return "unknown";
}

export function updateAccountCategory(
  db: DbExecutor,
  mfId: string,
  categoryName: string,
): void {
  const categoryId = getOrCreateInstitutionCategory(db, categoryName);

  db
    .update(schema.accounts)
    .set({ categoryId, updatedAt: now() })
    .where(eq(schema.accounts.mfId, mfId))
    .run();
}

/**
 * 全アカウントのname/mfIdからidへのマップを構築
 * トランザクション保存時のaccount_idルックアップ用
 */
export function buildAccountIdMap(db: DbExecutor): Map<string, string> {
  const accounts = db.select().from(schema.accounts).all();
  const map = new Map<string, string>();

  for (const account of accounts) {
    if (account.mfId !== null) map.set(account.mfId, account.id);
    map.set(account.name, account.id);
  }

  return map;
}

/**
 * 複数アカウントの一括upsert
 */
export function upsertAccounts(db: DbExecutor, accounts: AccountStatus[]): void {
  if (accounts.length === 0) return;

  const timestamp = now();

  for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
    const batch = accounts.slice(i, i + BATCH_SIZE);
    const records = batch.map((account) => {
      const mfId = account.mfId || account.name;
      return {
        id: mfId,
        mfId,
        name: account.name,
        type: account.type,
        institution: account.name,
        // 現行 schema 固有の必須列（本家には無い）。crawler 由来の AccountStatus には無いので既定値
        category: "other",
        balance: 0,
        scrapedAt: timestamp,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    });

    db
      .insert(schema.accounts)
      .values(records)
      .onConflictDoUpdate({
        target: schema.accounts.mfId,
        set: {
          name: sql`excluded.name`,
          type: sql`excluded.type`,
          isActive: sql`excluded.is_active`,
          updatedAt: timestamp,
        },
      })
      .run();
  }
}

/**
 * 複数アカウントステータスの一括upsert
 */
export function saveAccountStatuses(
  db: DbExecutor,
  statuses: Array<{ accountId: string; status: AccountStatus }>,
): void {
  if (statuses.length === 0) return;

  const timestamp = now();

  for (let i = 0; i < statuses.length; i += BATCH_SIZE) {
    const batch = statuses.slice(i, i + BATCH_SIZE);
    const records = batch.map(({ accountId, status }) => {
      const isoLastUpdated = convertToIsoDate(status.lastUpdated);
      return {
        accountId,
        status: status.status,
        lastUpdated: isoLastUpdated,
        totalAssets: status.totalAssets ?? 0,
        errorMessage: status.errorMessage ?? null,
        // 現行 schema 固有の必須列（本家には無い）
        balance: 0,
        scrapedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    });

    db
      .insert(schema.accountStatuses)
      .values(records)
      .onConflictDoUpdate({
        target: schema.accountStatuses.accountId,
        set: {
          status: sql`excluded.status`,
          lastUpdated: sql`excluded.last_updated`,
          totalAssets: sql`excluded.total_assets`,
          errorMessage: sql`excluded.error_message`,
          updatedAt: timestamp,
        },
      })
      .run();
  }

  for (const { accountId, status } of statuses) {
    if (status.scheduledWithdrawalAmount === undefined) continue;
    db
      .update(schema.accountStatuses)
      .set({
        scheduledWithdrawalAmount: status.scheduledWithdrawalAmount,
        scheduledWithdrawalConfirmed: status.scheduledWithdrawalConfirmed ?? false,
        updatedAt: timestamp,
      })
      .where(eq(schema.accountStatuses.accountId, accountId))
      .run();
  }
}
