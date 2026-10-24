/**
 * 旧世代 transactions の掃除（`accounts[0]` フォールバックの産物）。
 *
 * 2026-10 以前の parseTransactions は「保有金融機関」を解決できず、全行を accounts[0]
 * （実測ではイオン銀行 `IP0DwtoCovpotYPHltPahQ`）に割り当てていた。次回スクレイプで
 * 正しい口座に同じ 36 行が再投入されると、旧 36 行が残って二重化する（36 → 72 行）。
 * 本スクリプトはその旧行を削除し、併せて死んだ列 holdings.liability_category を NULL に戻す
 * （過去の負債分類の残渣が、将来負債行が現れた時に復活しないように）。
 *
 * 誤爆を防ぐ 2 つの安全弁（--apply 時はどちらかに当たると中断し applied: false を返す）:
 *   1. account_id が accounts に存在しない（タイプミス）→ 何も書かない
 *   2. 対象行が「旧世代行（external_id IS NULL）と現行行の混在」→ 何も書かない
 *      （旧世代行だけ / 現行行だけ のどちらでもなく、混在のみ中断。現行行だけを消す事故を止める）
 *
 * 使い方:
 *   # 本番（Docker）: 既定は ./.data/asset-scraping.db なので --db を必ず明示する
 *   tsx src/scripts/fix-fallback-transactions.ts --db /data/asset-scraping.db --account-id <accounts.id>
 *   tsx src/scripts/fix-fallback-transactions.ts --db /data/asset-scraping.db --account-id <accounts.id> --apply
 *   # ローカル: --db 省略時は resolveDbPath()（既定 ./.data/asset-scraping.db）
 *   tsx src/scripts/fix-fallback-transactions.ts --account-id <accounts.id>
 */
import DatabaseConstructor from "better-sqlite3";
import { pathToFileURL } from "node:url";
import { resolveDbPath } from "../client.js";

export interface FixFallbackTransactionsOptions {
  /** false（既定）= dry-run。件数を数えるだけで一切変更しない */
  apply?: boolean;
}

export interface FixFallbackTransactionsReport {
  accountId: string;
  /** 対象口座の name（存在しなければ null） */
  accountName: string | null;
  /** 削除対象になる transactions 行数 */
  transactionRows: number;
  /** 対象行のうち external_id が NULL の件数（旧世代行 = 0 なら現行パーサ由来のみ） */
  nullExternalIdRows: number;
  /** type='asset' かつ liability_category が非 NULL の holdings 行数 */
  holdingsLiabilityRows: number;
  /** 実際に変更したか */
  applied: boolean;
  /** 中断理由（安全弁に当たった時のみ非 null）。null なら中断していない */
  abortedReason: string | null;
}

/** liability_category を消してよいのは asset 行だけ（liability 行の分類は将来の負債内訳の実データ） */
// COUNT と UPDATE は同一条件でなければならない（件数表示と実際の更新対象を一致させる）

export function fixFallbackTransactions(
  dbPath: string,
  accountId: string,
  options: FixFallbackTransactionsOptions = {},
): FixFallbackTransactionsReport {
  const apply = options.apply ?? false;
  const sqlite = new DatabaseConstructor(dbPath, { fileMustExist: true });
  try {
    const accountName =
      (sqlite.prepare("SELECT name FROM accounts WHERE id = ?").pluck().get(accountId) as
        | string
        | undefined) ?? null;
    const count = (sql: string, ...params: unknown[]) =>
      sqlite.prepare(sql).pluck().get(...params) as number;

    const before = {
      transactionRows: count("SELECT COUNT(*) FROM transactions WHERE account_id = ?", accountId),
      nullExternalIdRows: count(
        "SELECT COUNT(*) FROM transactions WHERE account_id = ? AND external_id IS NULL",
        accountId,
      ),
      holdingsLiabilityRows: count(
        "SELECT COUNT(*) FROM holdings WHERE type = 'asset' AND liability_category IS NOT NULL",
      ),
    };

    // 安全弁。書く前に判定する（存在しない口座 ID で holdings だけ消える経路を作らない）
    const abortedReason =
      accountName === null
        ? `account_id=${accountId} が accounts に存在しない`
        : before.transactionRows > 0 && before.nullExternalIdRows !== before.transactionRows
          ? `旧世代行（external_id IS NULL ${before.nullExternalIdRows} 行）と現行行が混在しているため中断した`
          : null;

    let applied = false;
    if (apply && abortedReason === null) {
      // 途中で落ちても半端な削除を残さない（DELETE と UPDATE を 1 トランザクションに）
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        // external_id IS NULL は混在ガードと同条件（ガードが緩んでも口座全削除に化けない二重錠）
        sqlite
          .prepare("DELETE FROM transactions WHERE account_id = ? AND external_id IS NULL")
          .run(accountId);
        sqlite
          .prepare(
            "UPDATE holdings SET liability_category = NULL WHERE type = 'asset' AND liability_category IS NOT NULL",
          )
          .run();
        sqlite.exec("COMMIT");
        applied = true;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    }

    return { accountId, accountName, ...before, applied, abortedReason };
  } finally {
    sqlite.close();
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function flagValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(argv: string[]): number {
  const accountId = flagValue(argv, "--account-id");
  if (!accountId) {
    console.error(
      "使い方: tsx src/scripts/fix-fallback-transactions.ts --db /data/asset-scraping.db --account-id <accounts.id> [--apply]",
    );
    console.error(
      "      本番（Docker）は --db /data/asset-scraping.db を明示すること（既定は ./.data/asset-scraping.db）",
    );
    return 1;
  }
  const dbPath = flagValue(argv, "--db") ?? resolveDbPath();
  const apply = argv.includes("--apply");

  console.log(`DB: ${dbPath}`);
  if (flagValue(argv, "--db") === undefined) {
    console.log("注意: --db 未指定のため既定値を使用。本番は --db /data/asset-scraping.db を明示すること");
  }
  console.log(`対象 account_id: ${accountId}`);
  // 削除は不可逆なので、先にバックアップを案内する
  console.log(
    `バックアップ: sqlite3 '${dbPath}' ".backup '${dbPath}.bak'"` +
      (dbPath.includes("/data/") ? "" : "   （本番は --db /data/asset-scraping.db を付けて同じ手順で）"),
  );
  console.log("（--apply の直前にこのコマンドで控えを取ること）");

  const report = fixFallbackTransactions(dbPath, accountId, { apply });

  console.log(`対象口座 name: ${report.accountName ?? "（見つからない）"}`);
  console.log(`削除対象 transactions: ${report.transactionRows} 行`);
  console.log(`うち external_id IS NULL: ${report.nullExternalIdRows} 行`);
  console.log(`holdings.liability_category 非 NULL（type='asset' のみ）: ${report.holdingsLiabilityRows} 行`);

  if (report.abortedReason !== null) {
    console.error(`中断: ${report.abortedReason}`);
    console.error("何も変更していない。account_id と対象行を確認し直すこと");
    return 1;
  }

  if (report.applied) {
    console.log(
      `削除しました: ${report.transactionRows} 行 / liability_category を NULL に更新: ${report.holdingsLiabilityRows} 行`,
    );
  } else {
    console.log("[dry-run] 変更していません。実行するには --apply を付ける");
  }
  return 0;
}

// tsx 直接実行時のみ CLI を走らせる（テストからの import で副作用を出さない）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
