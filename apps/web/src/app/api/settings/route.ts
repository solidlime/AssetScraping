import { NextResponse, type NextRequest } from "next/server";

/**
 * 設定 API のプロキシ。crawler (:8766) の GET/PUT /settings を中継する。
 * GET は定期更新時刻・残高しきい値・認証情報（パスワードはマスク: hasPassword のみ）を返す。
 * PUT ボディ: { scheduledRefreshTime?, lowBalanceThreshold?, credential?: { loginId, password? } }
 * パスワード省略・空文字時は既存値を保持（crawler 側仕様）。
 */
export const dynamic = "force-dynamic";

const CRAWLER_TIMEOUT_MS = 10_000;

function crawlerBase(): string {
  return process.env.CRAWLER_URL ?? "http://crawler:8766";
}

export async function GET() {
  try {
    const res = await fetch(`${crawlerBase()}/settings`, {
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

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${crawlerBase()}/settings`, {
      method: "PUT",
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
