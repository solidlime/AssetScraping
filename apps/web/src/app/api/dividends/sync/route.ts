import { NextResponse } from "next/server";

/**
 * 配当・分配の再取得プロキシ。crawler (:8766) の POST /dividends/sync を中継する。
 * Yahoo から配当イベント＋為替を取り直す重い処理なのでタイムアウトは長め。
 * crawler は SyncResult（{ symbols, events, fx, errors[] }）をそのまま返す。
 */
export const dynamic = "force-dynamic";

const CRAWLER_TIMEOUT_MS = 5 * 60 * 1000;

export async function POST() {
  const base = process.env.CRAWLER_URL ?? "http://crawler:8766";
  try {
    const res = await fetch(`${base}/dividends/sync`, {
      method: "POST",
      signal: AbortSignal.timeout(CRAWLER_TIMEOUT_MS),
    });
    const body = (await res.json()) as Record<string, unknown>;
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
