import type { DbExecutor } from "../index.ts";
import { schema } from "../index.ts";
import { getOrCreate } from "../utils.ts";

/**
 * 名前ベースで asset_categories を取得または作成する。
 * normalizeCategory は使わず、スクレイパーが提供する名前をそのまま使う。
 */
export function getOrCreateCategory(db: DbExecutor, name: string): number {
  return getOrCreate(db, schema.assetCategories, schema.assetCategories.name, name);
}
