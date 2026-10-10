/**
 * 手動更新・設定 HTTP API (:8766)。
 * - POST /update   → runScrape を実行し、結果サマリを JSON で返す（同時実行は排他）
 * - GET  /settings → 設定取得（定期更新時刻 / 残高しきい値 / 認証情報。パスワードは返さない）
 * - PUT  /settings → 設定更新
 * - GET  /health   → 稼働状態
 * web ダッシュボードの設定タブ・手動更新ボタンから /api/* を経由して呼ばれる。
 * 定期更新は Docker crontab の代わりにこのプロセス内 setInterval ループで実施。
 * 設定時刻 (app_settings.scheduled_refresh_time) は毎 tick DB から読み直すため、
 * UI 変更が即反映される。到達判定は既存の純粋関数 nextOccurrenceJst (scheduler.ts) を使用。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  createDb,
  getCrawlerCredential,
  getLowBalanceThreshold,
  getScheduledRefreshTime,
  resolveDbPath,
  setCrawlerCredential,
  setLowBalanceThreshold,
  setScheduledRefreshTime,
  type Database,
} from "@asset-scraping/db";
import { runScrape, type RunScrapeOptions } from "./scrape.js";
import { getOtpStatus, submitOtpCode } from "./otp.js";
import { TwoFactorRequiredError } from "./auth.js";
import { nextOccurrenceJst } from "./scheduler.js";

const PORT = Number(process.env.PORT ?? 8766);
/** 定期更新ループの tick 間隔（= 設定時刻の読み直し間隔） */
const SCHEDULER_INTERVAL_MS = 30_000;

let running = false;
let lastResult:
  | { startedAt: string; finishedAt: string; ok: boolean; source: string; error?: string }
  | null = null;
/** 次回定期更新の epoch ms。未確定は null（次 tick で計算・確定） */
let nextRunAt: number | null = null;

let dbHandle: Database | null = null;
function getDb(): Database {
  if (!dbHandle) dbHandle = createDb({ path: resolveDbPath() });
  return dbHandle;
}

/** POST ボディを読む（/otp/submit 用） */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

interface RunOutcome {
  ok: boolean;
  stats?: unknown;
  error?: string;
  twoFactor?: boolean;
}

/** runScrape の共通実行体。HTTP とスケジューラの両方から呼ぶ（同時実行は排他） */
async function execRunScrape(source: string): Promise<RunOutcome> {
  if (running) return { ok: false, error: "scrape is already running" };
  running = true;
  const startedAt = new Date().toISOString();
  try {
    const options: RunScrapeOptions = {
      history: process.env.SCRAPE_MODE === "history",
    };
    const stats = await runScrape(getDb(), options);
    lastResult = { startedAt, finishedAt: stats.finishedAt, ok: true, source };
    console.log(`[crawler] scrape done (${source}): ${JSON.stringify(stats)}`);
    return { ok: true, stats };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const twoFactor = err instanceof TwoFactorRequiredError;
    lastResult = { startedAt, finishedAt: new Date().toISOString(), ok: false, source, error: message };
    console.error(`[crawler] scrape failed (${source}):`, message);
    return { ok: false, error: message, twoFactor };
  } finally {
    running = false;
  }
}

async function handleUpdate(res: ServerResponse): Promise<void> {
  const outcome = await execRunScrape("manual");
  const status = outcome.ok ? 200 : outcome.twoFactor ? 503 : outcome.error === "scrape is already running" ? 409 : 500;
  sendJson(res, status, outcome.ok ? { ok: true, stats: outcome.stats } : { ok: false, error: outcome.error });
}

/** 設定タブ用ペイロード。パスワードはマスク（hasPassword のみ返す） */
function settingsPayload(db: Database): Record<string, unknown> {
  const credential = getCrawlerCredential(db, {
    loginId: process.env.SSNB_LOGIN_ID,
    password: process.env.SSNB_PASSWORD,
  });
  return {
    ok: true,
    scheduledRefreshTime: getScheduledRefreshTime(db),
    lowBalanceThreshold: getLowBalanceThreshold(db),
    credential: credential
      ? { loginId: credential.loginId, hasPassword: true }
      : { loginId: "", hasPassword: false },
  };
}

function applySettingsUpdate(db: Database, body: Record<string, unknown>): void {
  if (typeof body.scheduledRefreshTime === "string") {
    setScheduledRefreshTime(db, body.scheduledRefreshTime);
  }
  if (body.lowBalanceThreshold !== undefined) {
    const n = Number(body.lowBalanceThreshold);
    if (!Number.isFinite(n)) throw new Error("lowBalanceThreshold は数値で指定してください");
    setLowBalanceThreshold(db, n);
  }
  if (body.credential !== undefined) {
    const cred = body.credential as Record<string, unknown> | null;
    if (cred === null || typeof cred.loginId !== "string" || cred.loginId.length === 0) {
      throw new Error("credential.loginId は必須です");
    }
    const rawPassword = cred.password;
    if (rawPassword !== undefined && rawPassword !== null && typeof rawPassword !== "string") {
      throw new Error("credential.password は文字列で指定してください");
    }
    // password が空文字・未指定の場合は既存値を保持する（ID のみ変更）
    setCrawlerCredential(db, cred.loginId, typeof rawPassword === "string" ? rawPassword : "");
  }
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length === 0) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

async function handleSettingsPut(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readJsonBody(req);
    applySettingsUpdate(getDb(), body);
    sendJson(res, 200, settingsPayload(getDb()));
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * 定期更新ループの外側。純粋関数 nextOccurrenceJst で次回時刻を管理する:
 * - 未確定 → 次回時刻を計算して確定
 * - 到達 → 実行し、次回は未確定に戻す（完了後の次 tick で翌日分を確定）
 * - 到達前に設定変更 → 新しい時刻に差し替え
 */
export function schedulerTick(now = new Date()): boolean {
  if (running) return false;
  // 設定時刻は毎 tick DB から読み直す（UI 変更が即反映される）
  const targetTime = getScheduledRefreshTime(getDb());
  const desired = nextOccurrenceJst(now, targetTime);
  if (nextRunAt === null) {
    nextRunAt = desired;
    return false;
  }
  if (now.getTime() >= nextRunAt) {
    nextRunAt = null;
    void execRunScrape("scheduled");
    return true;
  }
  if (desired !== nextRunAt) {
    nextRunAt = desired;
  }
  return false;
}

export function startScheduler(intervalMs = SCHEDULER_INTERVAL_MS): NodeJS.Timeout {
  const timer = setInterval(() => {
    try {
      schedulerTick();
    } catch (err) {
      console.error("[crawler] scheduler tick failed:", err instanceof Error ? err.message : err);
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}

export function getSchedulerState(): { nextRunAt: number | null; running: boolean } {
  return { nextRunAt, running };
}

export function startServer(port = PORT): void {
  const server = createServer((req, res) => {
    void route(req, res);
  });
  server.listen(port, () => {
    console.log(`[crawler] manual-update API listening on :${port}`);
  });
  startScheduler();
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = (req.url ?? "/").split("?")[0];
  if (req.method === "POST" && url === "/update") {
    await handleUpdate(res);
    return;
  }
  if (req.method === "GET" && url === "/settings") {
    sendJson(res, 200, settingsPayload(getDb()));
    return;
  }
  if (req.method === "PUT" && url === "/settings") {
    await handleSettingsPut(req, res);
    return;
  }
  if (req.method === "GET" && url === "/otp/status") {
    // 2FA OTP 待ち状態の外部可視化（ステータスファイルの内容をそのまま返す）
    sendJson(res, 200, { ok: true, ...getOtpStatus() });
    return;
  }
  if (req.method === "POST" && url === "/otp/submit") {
    try {
      const parsed = JSON.parse(await readBody(req)) as { code?: string };
      const code = typeof parsed.code === "string" ? parsed.code : "";
      if (!code) {
        sendJson(res, 400, { ok: false, error: "code is required" });
        return;
      }
      // 同プロセスの待ち手がいれば true（即時解決）。無ければステータスファイルに残す
      const delivered = submitOtpCode(code);
      sendJson(res, 200, { ok: true, delivered });
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid JSON body" });
    }
    return;
  }
  if (req.method === "GET" && url === "/health") {
    sendJson(res, 200, { ok: true, running, lastResult, nextRunAt });
    return;
  }
  sendJson(res, 404, { ok: false, error: "not found" });
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isDirectRun) {
  startServer();
}
