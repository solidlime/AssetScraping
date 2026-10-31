import { NextResponse, type NextRequest } from "next/server";

/**
 * 固定費（口座引き落とし）のプロキシ。crawler (:8766) の /fixed-costs を中継する。
 * 検証は crawler 側（validateScheduledPayment）に寄せ、web では何も検証しない。
 * 400/404 は crawler のボディをそのまま素通しする。
 */
export const dynamic = "force-dynamic";

const CRAWLER_TIMEOUT_MS = 10_000;

function crawlerBase(): string {
  return process.env.CRAWLER_URL ?? "http://crawler:8766";
}

async function forward(method: "GET" | "POST" | "PUT" | "DELETE", req?: NextRequest) {
  try {
    const res = await fetch(`${crawlerBase()}/fixed-costs`, {
      method,
      headers: { "content-type": "application/json" },
      body: req ? JSON.stringify(await req.json()) : undefined,
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

export function GET() {
  return forward("GET");
}

export function POST(req: NextRequest) {
  return forward("POST", req);
}

export function PUT(req: NextRequest) {
  return forward("PUT", req);
}

export function DELETE(req: NextRequest) {
  return forward("DELETE", req);
}
