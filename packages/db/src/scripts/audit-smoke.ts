/**
 * 完了監査の却下理由（①〜③）と語彙修正の検証スモーク。
 *
 * 実 DB（既定 .data/asset-scraping.db、DB_PATH で上書き可）に対して次を検査する:
 * - [1] hasInvestmentHoldings が true（却下理由①: 含み損益セクションの表示 gate）
 * - [2] getHoldingsWithLatestValues が全 holdings を返す（却下理由②: 保有資産が1件のみ）
 * - [3] getAssetBreakdownByCategory が複数カテゴリを返す（却下理由③: チャート空描画）
 * - [4] holdings.category_id が全行 non-null（①の前提条件）
 * - [5] asset_history.category が旧語彙を含まない（語彙統一 4d2d699 の効果）
 *
 * 使い方:
 *   pnpm --filter @asset-scraping/db exec tsx src/scripts/audit-smoke.ts
 */
import DatabaseConstructor from "better-sqlite3";
import { fileURLToPath } from "node:url";
import {
  createDb,
  getAssetBreakdownByCategory,
  getHoldingsWithLatestValues,
  hasInvestmentHoldings,
} from "../index.ts";

// プロジェクトルートの .data を cwd 依存なしに指す（DB_PATH 指定時はそちらを優先）
const root = fileURLToPath(new URL("../../../..", import.meta.url));
const dbPath = process.env.DB_PATH ?? `${root}/.data/asset-scraping.db`;

// raw 集計のため better-sqlite3 を直接開く（drizzle の型付きクエリでは count/DISTINCT が冗長）
const sqlite = new DatabaseConstructor(dbPath, { readonly: true, fileMustExist: true });
const db = createDb({ path: dbPath, readOnly: true });

console.log(`DB: ${dbPath}\n`);

const failures: string[] = [];
const check = (ok: boolean, label: string, detail: string) => {
  console.log(`${ok ? "  OK " : "  NG "} ${label}: ${detail}`);
  if (!ok) failures.push(label);
};

// [1][2] 却下理由①②
const holdings = await getHoldingsWithLatestValues(undefined, db);
const withValues = holdings.filter((h) => h.amount !== null);
check(
  holdings.length > 0,
  "getHoldingsWithLatestValues",
  `${holdings.length} rows (${withValues.length} with amount)`,
);
check(
  withValues.length === holdings.length,
  "全 holding に金額がある",
  `${withValues.length}/${holdings.length}`,
);

// [3] 却下理由③（バランスシート + 前日比ランキングの前提）
const hasInv = await hasInvestmentHoldings(undefined, db);
check(hasInv, "hasInvestmentHoldings", String(hasInv));

const breakdown = await getAssetBreakdownByCategory(undefined, db);
console.log("     内訳:");
for (const b of breakdown) console.log(`       ${b.category}: ${b.amount}`);
check(breakdown.length >= 2, "getAssetBreakdownByCategory", `${breakdown.length} categories`);

// [4] ①の前提: category_id が埋まっているか
const nullCat = sqlite
  .prepare("SELECT COUNT(*) AS c FROM holdings WHERE category_id IS NULL")
  .get() as { c: number };
const totalHoldings = sqlite.prepare("SELECT COUNT(*) AS c FROM holdings").get() as { c: number };
check(
  nullCat.c === 0,
  "holdings.category_id",
  `${totalHoldings.c - nullCat.c}/${totalHoldings.c} が non-null`,
);

// [5] 語彙統一: 旧語彙が残っていないこと（upsertAssetHistory の DELETE が効いているか）
const LEGACY = ["bank", "securities", "pension", "point", "crypto", "other", "cash", "real_estate"];
const cats = sqlite
  .prepare("SELECT DISTINCT category FROM asset_history WHERE category IS NOT NULL")
  .all() as Array<{ category: string }>;
const legacyLeft = cats.filter((r) => LEGACY.includes(r.category));
// 語彙は「警告」扱いにする: 構造不具合（①②③）ではなく「その DB が語彙統一後に再スクレイプ
// されたか」の指標なので、exit code には反映しない（NAS 検証では 0 件が期待値）。
console.log(
  `${legacyLeft.length === 0 ? "  OK " : "  WARN"} asset_history の語彙: ${
    cats.length === 0
      ? "行なし（未スクレイプ）"
      : `${cats.map((r) => r.category).join(", ")}${
          legacyLeft.length > 0
            ? `\n       ← 旧語彙 ${legacyLeft.length} 語残存。この DB は語彙統一 (4d2d699) 後に再スクレイプされていない`
            : ""
        }`
  }`,
);

console.log(
  failures.length === 0
    ? "\nAUDIT SMOKE: PASSED"
    : `\nAUDIT SMOKE: FAILED (${failures.join(", ")})`,
);
process.exit(failures.length === 0 ? 0 : 1);
