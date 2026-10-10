/**
 * MCP ツールの共通実行ヘルパー: read-only DB を開いてクエリし、JSON テキストで返す。
 */
import type { Database } from "@asset-scraping/db";
import { createDb, resolveDbPath } from "@asset-scraping/db";

export function openReadOnlyDb(): Database {
  const path = resolveDbPath();
  // Docker では file:/data/asset-scraping.db?mode=ro を DB_PATH に指定する。
  // ホスト実行時は readOnly フラグで開く。
  if (path.startsWith("file:")) {
    return createDb({ path: path.includes("?") ? path : `${path}?mode=ro` });
  }
  return createDb({ path, readOnly: true });
}

// SAFETY: drizzle の内部クライアントは $client で better-sqlite3 を保持する（公開型には無い）
export function closeDb(db: unknown): void {
  const client = (db as { $client?: { close(): void } }).$client;
  client?.close();
}

export async function dbTool<T>(query: (db: Database) => T | Promise<T>): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  let db: Database | null = null;
  try {
    db = openReadOnlyDb();
    // async クエリ（getFinancialMetrics 等）も受け取れるよう await する。
    // 同期クエリでは await が素通しになるだけで挙動は変わらない。
    const result = await query(db);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      content: [
        { type: "text", text: `DB read failed: ${err instanceof Error ? err.message : String(err)}` },
      ],
      isError: true,
    };
  } finally {
    if (db) closeDb(db);
  }
}
