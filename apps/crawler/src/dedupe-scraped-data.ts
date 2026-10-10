/**
 * 既存の重複スクレイプデータのクリーンアップ（1回限り・冪等）。
 *
 * 背景（F2/F3 実データ観測）:
 * - F2 holdings: 銀行/電子マネーの残高内訳ページは集約テーブル（種類・名称）と
 *   支店/カード内訳テーブル（名称）が併存し、同一口座・同一金額が別名で 2 行
 *   保存されていた（合計 77,708 円の二重計上）。parser 側は修正済みだが、
 *   既存行は別名のため unique index (account_id, name) では消えない。
 * - F3 transactions: externalId が null のまま unique index が機能せず、
 *   再スクレイプ毎に同一取引が追記されていた（72+ 行 / 実ユニーク 9 件）。
 *
 * 方針:
 * - transactions: 判定は packages/db の dedupeLegacyTransactions に集約。
 *   (口座, 日付, 摘要, 符号付き金額) が同一で決定的 externalId 行が存在する旧 NULL 行は
 *   再取得可能な重複として削除。決定的行が無い旧 NULL 行は消さず決定的 externalId を
 *   付与し、次回 upsert が同一行に収束するようにする（"同日同額同摘要でも正当に複数" は
 *   決定的行として残るため消えない）。冪等。
 * - holdings: 同一口座・同一金額の 2 行組のうち、支店/カード内訳行（名前が
 *   集約行の部分文字列、または「支店」を含み他方が含まない、または口座名に
 *   現れない方）を削除候補とする。判定不能な組は削除せず警告のみ。冪等。
 *
 * 使い方:
 *   DB_PATH=/path/to/asset-scraping.db npx tsx src/dedupe-scraped-data.ts [--dry-run]
 *   （未指定時は resolveDbPath() = ./.data/asset-scraping.db）
 *
 * 注意: 削除前に <db>.bak へバックアップを取る。
 */
import { inArray } from "drizzle-orm";
import { createDb, dedupeLegacyTransactions, resolveDbPath, schema } from "@asset-scraping/db";

const dryRun = process.argv.includes("--dry-run");
const dbPath = resolveDbPath();
console.log(`dedupe: db=${dbPath}${dryRun ? " (dry-run: 書き込みません)" : ""}`);

const db = createDb({ path: dbPath });

// ---------------------------------------------------------------------------
// F2: holdings の二重計上
// ---------------------------------------------------------------------------

interface HoldingRow {
  id: number;
  accountId: string;
  name: string;
  value: number;
}

const accounts = db
  .select({
    id: schema.accounts.id,
    name: schema.accounts.name,
    institution: schema.accounts.institution,
  })
  .from(schema.accounts)
  .all();
const accountLabels = new Map(accounts.map((a) => [a.id, `${a.name} ${a.institution}`]));

const holdings = db
  .select({
    id: schema.holdings.id,
    accountId: schema.holdings.accountId,
    name: schema.holdings.name,
    value: schema.holdings.value,
  })
  .from(schema.holdings)
  .all();

const holdingGroups = new Map<string, HoldingRow[]>();
for (const h of holdings) {
  const key = `${h.accountId}\u0000${h.value}`;
  const list = holdingGroups.get(key);
  if (list) list.push(h);
  else holdingGroups.set(key, [h]);
}

/**
 * 同一金額の 2 行から、支店/カード内訳（重複）側を返す。判定不能は null。
 * 順序が重要: 部分文字列 → 支店語 → 口座名一致。
 */
function pickBranchDuplicate(
  a: HoldingRow,
  b: HoldingRow,
  accountLabel: string,
): HoldingRow | null {
  if (a.name.includes(b.name)) return b;
  if (b.name.includes(a.name)) return a;
  const aBranch = a.name.includes("支店");
  const bBranch = b.name.includes("支店");
  if (aBranch !== bBranch) return aBranch ? a : b;
  const aInAccount = accountLabel.includes(a.name);
  const bInAccount = accountLabel.includes(b.name);
  if (aInAccount !== bInAccount) return aInAccount ? b : a;
  return null;
}

const holdingsToDelete: HoldingRow[] = [];
const holdingsAmbiguous: HoldingRow[][] = [];
for (const rows of holdingGroups.values()) {
  if (rows.length !== 2) {
    if (rows.length > 2) holdingsAmbiguous.push(rows);
    continue;
  }
  const [a, b] = rows as [HoldingRow, HoldingRow];
  if (a.value === 0) continue; // 0 円は消さない
  const dup = pickBranchDuplicate(a, b, accountLabels.get(a.accountId) ?? "");
  if (dup) holdingsToDelete.push(dup);
  else holdingsAmbiguous.push(rows);
}

// ---------------------------------------------------------------------------
// F3: transactions の重複蓄積
//
// 判定（同一内容の決定的 externalId 行との突合）は packages/db の
// dedupeLegacyTransactions に集約した（テスト可能にするため）。
// ここでは dry-run で件数を表示し、実際の削除/付与は下の本処理で行う。
// ---------------------------------------------------------------------------

const txTotal = db.select({ id: schema.transactions.id }).from(schema.transactions).all().length;
const txResult = dedupeLegacyTransactions(db, { dryRun: true });

// ---------------------------------------------------------------------------
// 結果表示
// ---------------------------------------------------------------------------

console.log(
  `\n[F2 holdings] 削除候補 ${holdingsToDelete.length} 件 / 判定不能 ${holdingsAmbiguous.length} 組`,
);
for (const h of holdingsToDelete) {
  console.log(`  - delete #${h.id} "${h.name}" (${h.value}円, account=${h.accountId.slice(0, 8)}…)`);
}
for (const rows of holdingsAmbiguous) {
  console.log(
    `  ! ambiguous: ${rows.map((r) => `#${r.id} "${r.name}" ${r.value}円`).join(" vs ")}`,
  );
}

console.log(
  `\n[F3 transactions] 全 ${txTotal} 行 → 削除 ${txResult.deleted} 件 / 残 ${txTotal - txResult.deleted} 件 / externalId 付与 ${txResult.reassigned} 件`,
);

if (dryRun) {
  console.log("\ndedupe: dry-run のため書き込みません。");
  process.exit(0);
}

if (holdingsToDelete.length === 0 && txResult.deleted + txResult.reassigned === 0) {
  console.log("\ndedupe: 削除対象なし。バックアップも不要。");
  process.exit(0);
}

// バックアップ（better-sqlite3 backup API で WAL 込みの一貫コピー）
const backupPath = `${dbPath}.bak`;
const client = (db as unknown as { $client: { backup(dest: string): Promise<unknown> } }).$client;
await client.backup(backupPath);
console.log(`\ndedupe: backup -> ${backupPath}`);

db.transaction((tx) => {
  if (holdingsToDelete.length > 0) {
    tx.delete(schema.holdings)
      .where(inArray(schema.holdings.id, holdingsToDelete.map((h) => h.id)))
      .run();
  }
});

const txDone = dedupeLegacyTransactions(db);

console.log(
  `dedupe: done. holdings -${holdingsToDelete.length} / transactions -${txDone.deleted} / externalId 付与 ${txDone.reassigned}`,
);
