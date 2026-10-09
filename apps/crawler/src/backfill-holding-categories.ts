/**
 * 旧 schema で登録された holdings（category_id = null）へのカテゴリバックフィル。
 *
 * 背景: 新コード（upsertHoldings）は新規スクレイプ時に assetCategory →
 * asset_categories 自動登録・categoryId 割当を行うが、旧データは categoryId が
 * null のため /bs カテゴリ集計（getAssetBreakdownByCategory・hasInvestmentHoldings）
 * が崩れる。本スクリプトは crawler の estimateAssetCategory と同じ推定で
 * 既存 holdings に categoryId を割当てる（冪等: すでに割当済みの行は skip）。
 *
 * 使い方: npx tsx src/backfill-holding-categories.ts
 */
import { eq, isNull } from "drizzle-orm";
import { createDb, getOrCreateCategory, schema } from "@asset-scraping/db";
import { estimateAssetCategory } from "./parse.js";
import type { AccountCategory } from "@asset-scraping/shared";

const db = createDb({ path: "../../.data/asset-scraping.db" });

const accounts = db.select().from(schema.accounts).all();
const categoryByAccountId = new Map<string, AccountCategory | undefined>(
  accounts.map((a) => [a.id, a.category as AccountCategory]),
);

const targets = db
  .select()
  .from(schema.holdings)
  .where(isNull(schema.holdings.categoryId))
  .all();

if (targets.length === 0) {
  console.log("backfill: no holdings with null category_id — nothing to do");
  process.exit(0);
}

db.transaction((tx) => {
  const categoryNameToId = new Map<string, number>();
  for (const h of targets) {
    const name = estimateAssetCategory(h.name, categoryByAccountId.get(h.accountId));
    let categoryId = categoryNameToId.get(name);
    if (categoryId === undefined) {
      categoryId = getOrCreateCategory(tx, name);
      categoryNameToId.set(name, categoryId);
    }
    tx.update(schema.holdings)
      .set({ categoryId, updatedAt: new Date().toISOString() })
      .where(eq(schema.holdings.id, h.id))
      .run();
    console.log(`backfill: holding ${h.id} "${h.name}" -> ${name} (#${categoryId})`);
  }
});

console.log(`backfill: ${targets.length} holdings updated`);
