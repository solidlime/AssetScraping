import { NextResponse, type NextRequest } from "next/server";

/**
 * 手動マッピングのプロキシ。crawler (:8766) の POST /dividends/mapping を中継する。
 * 検証エラーは crawler が 400 + { ok:false, error } で返す。
 */
export const dynamic = "force-dynamic";

const CRAWLER_TIMEOUT_MS = 10_000;

export async function POST(req: NextRequest) {
  const base = process.env.CRAWLER_URL ?? "http://crawler:8766";
  try {
    const body = await req.json();
    const res = await fetch(`${base}/dividends/mapping`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CRAWLER_TIMEOUT_MS),
    });
    const resBody = (await res.json()) as Record<string, unknown>;
    return NextResponse.json(resBody, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
