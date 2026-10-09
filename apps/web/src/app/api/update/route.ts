import { NextResponse } from "next/server";

/**
 * 手動更新のプロキシ。crawler (:8766) へ POST /update を中継する。
 * CRAWLER_URL は Next.js サーバ側の環境変数（既定 http://crawler:8766）。
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const base = process.env.CRAWLER_URL ?? "http://crawler:8766";
  try {
    const res = await fetch(`${base}/update`, {
      method: "POST",
      signal: AbortSignal.timeout(10 * 60 * 1000),
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
