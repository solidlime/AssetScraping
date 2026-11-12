/**
 * MCP ツールの共通実行ヘルパー: read-only DB を開いてクエリし、JSON テキストで返す。
 */
import type { Database } from "@asset-scraping/db";
import { createDb, getLastScrapeResult, resolveDbPath } from "@asset-scraping/db";

/** これ以上成功していなければ「データが古い」として警告する */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const FAILURE_LABELS: Record<string, string> = {
  session_expired: "SSNB のセッション失効",
  two_factor: "SSNB の二段階認証待ち",
  login_required: "SSNB のログイン失敗",
  other: "取得失敗",
};

function formatJst(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/**
 * 直近のスクレイプ状態から警告文を作る（不要なら null）。
 * エージェントが古いデータを最新と誤認しないよう、結果の前に必ず添える。
 */
export function scrapeWarning(db: Database): string | null {
  const last = getLastScrapeResult(db);
  if (!last) return null;

  const lastSuccess = last.lastSuccessAt ? Date.parse(last.lastSuccessAt) : Number.NaN;
  const stale = !Number.isFinite(lastSuccess) || Date.now() - lastSuccess >= STALE_AFTER_MS;
  if (last.ok && !stale) return null;

  const lines: string[] = [];
  if (!last.ok) {
    const label = FAILURE_LABELS[last.kind ?? "other"] ?? FAILURE_LABELS.other;
    lines.push(
      `⚠ 直近のデータ取得に失敗しています（${label} / ${formatJst(last.finishedAt)}）。下のデータは失敗前のものです。`,
    );
    if (last.error) lines.push(`  エラー: ${last.error.slice(0, 160)}`);
  } else {
    const hours = Number.isFinite(lastSuccess)
      ? Math.floor((Date.now() - lastSuccess) / 3_600_000)
      : null;
    lines.push(
      `⚠ データが古い可能性があります（最終取得: ${last.lastSuccessAt ? formatJst(last.lastSuccessAt) : "不明"}${hours === null ? "" : ` / 約${hours}時間前`}）。`,
    );
  }
  lines.push(
    `  最終成功: ${last.lastSuccessAt ? formatJst(last.lastSuccessAt) : "なし"}`,
  );
  return lines.join("\n");
}

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
    const warning = scrapeWarning(db);
    const content: Array<{ type: "text"; text: string }> = [];
    if (warning) content.push({ type: "text", text: warning });
    content.push({ type: "text", text: JSON.stringify(result, null, 2) });
    return { content };
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
