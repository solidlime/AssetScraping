import { NextResponse, type NextRequest } from "next/server";

/**
 * OTP 待ち状態 API のプロキシ。crawler (:8766) の GET /otp/status・POST /otp/submit を中継する。
 * GET: { ok, status: "idle" | "waiting" | "submitted", requestedAt?, expiresAt?, code? }
 * POST ボディ: { code: string } — crawler 側で待ち手 (auth.ts waitForOtpCode) に即時解決される。
 */
export const dynamic = "force-dynamic";

const CRAWLER_TIMEOUT_MS = 10_000;

function crawlerBase(): string {
  return process.env.CRAWLER_URL ?? "http://crawler:8766";
}

export async function GET() {
  try {
    const res = await fetch(`${crawlerBase()}/otp/status`, {
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${crawlerBase()}/otp/submit`, {
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
