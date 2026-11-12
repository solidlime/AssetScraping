/**
 * MCP ツールの共通実行ヘルパー: read-only DB を開いてクエリし、JSON テキストで返す。
 */
import type { Database } from "@asset-scraping/db";
import {
  createDb,
  describeScrapeState,
  getLastScrapeResult,
  resolveDbPath,
} from "@asset-scraping/db";

/** 失敗種別の日本語ラベル（バナーと同じ語彙） */
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
  const state = describeScrapeState(last, Date.now());
  if (!last || !state) return null;
  if (state.failedKind === null && !state.stale) return null;

  const lines: string[] = [];
  if (state.failedKind !== null) {
    const label = FAILURE_LABELS[state.failedKind] ?? FAILURE_LABELS.other;
    lines.push(
      `⚠ 直近のデータ取得に失敗しています（${label} / ${formatJst(last.finishedAt)}）。下のデータは失敗前のものです。`,
    );
    if (last.error) lines.push(`  エラー: ${last.error.slice(0, 160)}`);
  } else {
    lines.push(
      `⚠ データが古い可能性があります（最終取得: ${formatJst(last.lastSuccessAt ?? last.finishedAt)}${state.hoursSinceSuccess === null ? "" : ` / 約${state.hoursSinceSuccess}時間前`}）。`,
    );
  }
  lines.push(`  最終成功: ${last.lastSuccessAt ? formatJst(last.lastSuccessAt) : "なし"}`);
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
