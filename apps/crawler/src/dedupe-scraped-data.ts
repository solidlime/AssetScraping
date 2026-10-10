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
 * - transactions: (口座, 日付, 摘要, 符号付き金額) でグループ化し、**最新バッチ
 *   (created_at) の行だけを残す**。最新バッチ内に同一内容が複数あれば、それを
 *   正当な複数回取引として全て保持する（"同日同額同摘要でも正当に複数" を消さない）。
 *   残した行には parser と同じ決定的 externalId/mfId を付与し、次回スクレイプの
 *   upsert が同一行に収束するようにする。冪等。
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
import { eq, inArray } from "drizzle-orm";
import { createDb, resolveDbPath, schema } from "@asset-scraping/db";
import { buildTransactionExternalId } from "@asset-scraping/shared";

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
// ---------------------------------------------------------------------------

interface TxRow {
  id: number;
  accountId: string;
  date: string;
  description: string;
  amount: number;
  type: string | null;
  createdAt: string | null;
  externalId: string | null;
}

const transactions = db
  .select({
    id: schema.transactions.id,
    accountId: schema.transactions.accountId,
    date: schema.transactions.date,
    description: schema.transactions.description,
    amount: schema.transactions.amount,
    type: schema.transactions.type,
    createdAt: schema.transactions.createdAt,
    externalId: schema.transactions.externalId,
  })
  .from(schema.transactions)
  .all();

function signedAmount(t: TxRow): number {
  // 旧データは type=null + 負値、新データは type=expense + 正值で保存されている。
  return t.type === "expense" ? -Math.abs(t.amount) : t.amount;
}

const txGroups = new Map<string, TxRow[]>();
for (const t of transactions) {
  const key = `${t.accountId}\u0000${t.date}\u0000${t.description}\u0000${signedAmount(t)}`;
  const list = txGroups.get(key);
  if (list) list.push(t);
  else txGroups.set(key, [t]);
}

const txRemoveIds: number[] = [];
/** 最新バッチに残した行へ付与する externalId/mfId（未付与 or 不一致の行のみ）。 */
const txReassign: Array<{ id: number; externalId: string }> = [];
for (const rows of txGroups.values()) {
  const sorted = [...rows].sort((a, b) => a.id - b.id);
  const latestCreatedAt = sorted.reduce(
    (max, r) => ((r.createdAt ?? "") > max ? (r.createdAt ?? "") : max),
    "",
  );
  const keep = sorted.filter((r) => (r.createdAt ?? "") === latestCreatedAt);
  for (const r of sorted) {
    if ((r.createdAt ?? "") !== latestCreatedAt) txRemoveIds.push(r.id);
  }
  const first = keep[0]!;
  const signed = signedAmount(first);
  keep.forEach((row, occurrence) => {
    const externalId = buildTransactionExternalId(
      row.accountId,
      row.date,
      row.description,
      signed,
      occurrence,
    );
    if (row.externalId !== externalId) txReassign.push({ id: row.id, externalId });
  });
}

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
  `\n[F3 transactions] 全 ${transactions.length} 行 → 削除 ${txRemoveIds.length} 件 / 残 ${transactions.length - txRemoveIds.length} 件 / externalId 付与 ${txReassign.length} 件`,
);

if (dryRun) {
  console.log("\ndedupe: dry-run のため書き込みません。");
  process.exit(0);
}

if (holdingsToDelete.length === 0 && txRemoveIds.length === 0) {
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

  if (txRemoveIds.length > 0) {
    tx.delete(schema.transactions).where(inArray(schema.transactions.id, txRemoveIds)).run();
  }

  for (const { id, externalId } of txReassign) {
    tx.update(schema.transactions)
      .set({ externalId, mfId: externalId, updatedAt: new Date().toISOString() })
      .where(eq(schema.transactions.id, id))
      .run();
  }
});

console.log(
  `dedupe: done. holdings -${holdingsToDelete.length} / transactions -${txRemoveIds.length} / externalId 付与 ${txReassign.length}`,
);
