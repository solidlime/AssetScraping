/**
 * MCP ツールの共通実行ヘルパー: read-only DB を開いてクエリし、JSON テキストで返す。
 */
import type { Database } from "@asset-scraping/db";
import {
  createDb,
  describeScrapeState,
  getLastScrapeResult,
  getUpcomingWithdrawals,
  resolveDbPath,
  summarizeWithdrawalShortages,
  todayJst,
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

/**
 * 引き落とし資金の不足警告（不要なら null）。
 * 金額不足は最も重要な情報なので、どのツール呼び出しでも結果の先頭に添える。
 */
export function withdrawalWarning(db: Database): string | null {
  const shortfalls = summarizeWithdrawalShortages(getUpcomingWithdrawals(db));
  if (shortfalls.length === 0) return null;

  const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
  const total = shortfalls.reduce((sum, s) => sum + s.shortage, 0);
  // 日数は日付同士の差で出す（現在時刻から引くと web の remainingDays と1日ずれる）
  const todayMs = Date.parse(`${todayJst()}T00:00:00+09:00`);
  const lines = [
    `⚠ 引き落とし資金が不足しています（不足合計 ${yen(total)}）。入金か口座間の振替が必要です。`,
  ];
  for (const s of shortfalls) {
    const days = Math.round((Date.parse(`${s.date}T00:00:00+09:00`) - todayMs) / 86_400_000);
    const names =
      s.items.length <= 2
        ? s.items.map((i) => i.paymentName ?? i.accountName).join(" + ")
        : `${s.items[0]!.paymentName ?? s.items[0]!.accountName} ほか${s.items.length - 1}件`;
    lines.push(
      `  ${s.date}（${days}日後）${s.withdrawalAccountName}: 予定 ${yen(s.amount)}（${names}） / 残高 ${yen(s.balance)} / 不足 ${yen(s.shortage)}`,
    );
  }
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
    const content: Array<{ type: "text"; text: string }> = [];
    // 順序は「取得失敗」→「資金不足」。どちらも先頭に置き、結果本体は最後
    for (const warning of [scrapeWarning(db), withdrawalWarning(db)]) {
      if (warning) content.push({ type: "text", text: warning });
    }
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
