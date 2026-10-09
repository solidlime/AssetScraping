/**
 * 手動更新 HTTP API (:8766)。
 * POST /update → runScrape を実行し、結果サマリを JSON で返す。
 * web ダッシュボードの手動更新ボタンから呼ばれる。同時実行は排他（1つだけ許可）。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createDb, resolveDbPath } from "@asset-scraping/db";
import { runScrape, type RunScrapeOptions } from "./scrape.js";
import { TwoFactorRequiredError } from "./auth.js";

const PORT = Number(process.env.PORT ?? 8766);

let running = false;
let lastResult: { startedAt: string; finishedAt: string; ok: boolean } | null = null;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

async function handleUpdate(res: ServerResponse): Promise<void> {
  if (running) {
    sendJson(res, 409, { ok: false, error: "scrape is already running" });
    return;
  }
  running = true;
  const startedAt = new Date().toISOString();
  try {
    const db = createDb({ path: resolveDbPath() });
    const options: RunScrapeOptions = {
      history: process.env.SCRAPE_MODE === "history",
    };
    const stats = await runScrape(db, options);
    lastResult = { startedAt, finishedAt: stats.finishedAt, ok: true };
    sendJson(res, 200, { ok: true, stats });
  } catch (err) {
    lastResult = { startedAt, finishedAt: new Date().toISOString(), ok: false };
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof TwoFactorRequiredError ? 503 : 500;
    sendJson(res, status, { ok: false, error: message });
  } finally {
    running = false;
  }
}

export function startServer(port = PORT): void {
  const server = createServer((req, res) => {
    void route(req, res);
  });
  server.listen(port, () => {
    console.log(`[crawler] manual-update API listening on :${port}`);
  });
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "/";
  if (req.method === "POST" && url === "/update") {
    await handleUpdate(res);
    return;
  }
  if (req.method === "GET" && url === "/health") {
    sendJson(res, 200, { ok: true, running, lastResult });
    return;
  }
  sendJson(res, 404, { ok: false, error: "not found" });
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isDirectRun) {
  startServer();
}
