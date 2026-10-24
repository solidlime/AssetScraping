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
import { eq } from "drizzle-orm";
import {
  accountStatuses,
  accounts,
  createDb,
  getCrawlerCredential,
  getLowBalanceThreshold,
  getScheduledRefreshTime,
  getWithdrawalAccountId,
  getWithdrawalAlertDays,
  isBankLikeAccount,
  resolveDbPath,
  resolveCrawlerCredential,
  setCrawlerCredential,
  setLowBalanceThreshold,
  setScheduledRefreshTime,
  setWithdrawalAccountId,
  setWithdrawalAlertDays,
  validateLowBalanceThreshold,
  validateScheduleTime,
  validateWithdrawalAlertDays,
  type Database,
} from "@asset-scraping/db";
import { runScrape, type RunScrapeOptions } from "./scrape.js";
import { getOtpStatus, submitOtpCode } from "./otp.js";
import { TwoFactorRequiredError } from "./auth.js";
import { nextOccurrenceJst } from "./scheduler.js";
import { syncDividends, upsertDividendSymbol, validateDividendMapping } from "./dividends.js";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

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

/**
 * server が唯一の常駐プロセスなので起動時にマイグレーションを適用する。
 * （cron 用 index.ts は db:migrate 前提のまま。宿 main に誤って db 追加が生じても無害＝冪等）
 */
function ensureMigrations(db: Database): void {
  migrate(db, {
    migrationsFolder: new URL("../../../packages/db/drizzle", import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      "$1",
    ),
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

/**
 * POST /dividends/mapping の検証・保存。HTTP 層とテストの両方から呼ぶ。
 * 200 = { ok: true, row }（保存後の行）、400 = { ok: false, error }。
 */
export function handleDividendMapping(
  db: Database,
  body: unknown,
): { status: number; body: unknown } {
  const validated = validateDividendMapping(body);
  if (!validated.ok) return { status: 400, body: { ok: false, error: validated.error } };
  const row = upsertDividendSymbol(db, validated.value);
  return { status: 200, body: { ok: true, row } };
}

/** 設定タブ用ペイロード。パスワードはマスク（hasPassword のみ返す） */
export function settingsPayload(db: Database): Record<string, unknown> {
  const credential = getCrawlerCredential(db, {
    loginId: process.env.SSNB_LOGIN_ID,
    password: process.env.SSNB_PASSWORD,
  });
  return {
    ok: true,
    scheduledRefreshTime: getScheduledRefreshTime(db),
    lowBalanceThreshold: getLowBalanceThreshold(db),
    withdrawalAlertDays: getWithdrawalAlertDays(db),
    withdrawalAccountId: getWithdrawalAccountId(db),
    // F7: カード別の引き落とし口座（手動設定専用のためスクレイプ経路では書かない）
    cardWithdrawalLinks: cardWithdrawalLinks(db),
    credential: credential
      ? { loginId: credential.loginId, hasPassword: true }
      : { loginId: "", hasPassword: false },
  };
}

function cardWithdrawalLinks(
  db: Database,
): { cardAccountId: string; cardName: string; withdrawalAccountId: string | null }[] {
  return db
    .select({
      cardAccountId: accounts.id,
      cardName: accounts.name,
      withdrawalAccountId: accounts.withdrawalAccountId,
    })
    .from(accounts)
    .where(eq(accounts.category, "card"))
    .all();
}

/**
 * カード別の引き落とし口座の検証（書込を伴わない）。キー = カードの accountId、値 = 引き落とし口座 or null 解除。
 * 未出現のキーは既存値を保持する。違反は throw して 400 経路に乗せる。
 */
function validateCardWithdrawalLinks(
  db: Database,
  raw: unknown,
): { cardId: string; value: string | null }[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("cardWithdrawalLinks はオブジェクトで指定してください");
  }
  const all = db.select().from(accounts).all();
  const byId = new Map(all.map((a) => [a.id, a]));
  // 予定額を持つ行（= カード扱いされる行）は引き落とし口座にできない（alerts.ts の isCardRow と同じ判定）
  const scheduledById = new Map(
    db
      .select({ accountId: accountStatuses.accountId, amount: accountStatuses.scheduledWithdrawalAmount })
      .from(accountStatuses)
      .all()
      .map((row) => [row.accountId, row.amount] as const),
  );
  const updates: { cardId: string; value: string | null }[] = [];
  for (const [cardId, value] of Object.entries(raw as Record<string, unknown>)) {
    const card = byId.get(cardId);
    if (!card) throw new Error(`cardWithdrawalLinks: 口座が存在しない: ${cardId}`);
    if (card.category !== "card") {
      throw new Error(`cardWithdrawalLinks: カード以外は指定できません: ${cardId}`);
    }
    if (value !== null && typeof value !== "string") {
      throw new Error("cardWithdrawalLinks の値は文字列か null で指定してください");
    }
    if (value === cardId) throw new Error("cardWithdrawalLinks: カード自身は指定できません");
    if (value !== null) {
      const account = byId.get(value);
      if (!account) throw new Error(`cardWithdrawalLinks: 口座が存在しない: ${value}`);
      // カード→カードの紐付けを拒否。予定額を持つ行も解決側でカード扱いされるので同様に拒否
      if (!isBankLikeAccount(account) || scheduledById.get(value) != null) {
        throw new Error(`cardWithdrawalLinks: 引き落とし口座にカードは指定できません: ${value}`);
      }
    }
    updates.push({ cardId, value: value as string | null });
  }
  return updates;
}

/** 検証済みの更新をまとめて書く（途中失敗時は 1 件も書かれない） */
function applyCardWithdrawalLinks(db: Database, updates: { cardId: string; value: string | null }[]): void {
  const ts = new Date().toISOString();
  db.transaction((tx) => {
    for (const { cardId, value } of updates) {
      tx.update(accounts)
        .set({ withdrawalAccountId: value, updatedAt: ts })
        .where(eq(accounts.id, cardId))
        .run();
    }
  });
}

/** 数値でない値を弾く（"abc" を NaN のまま後段に流さない） */
function toFiniteNumber(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${field} は数値で指定してください`);
  return n;
}

export function applySettingsUpdate(db: Database, body: Record<string, unknown>): void {
  // 1) 検証フェーズ: 全フィールドを先に検証する。
  // 途中で throw しても先行フィールドが確定しないように、書込は一切行わない。
  const scheduledRefreshTime =
    typeof body.scheduledRefreshTime === "string" ? validateScheduleTime(body.scheduledRefreshTime) : undefined;
  const lowBalanceThreshold =
    body.lowBalanceThreshold === undefined
      ? undefined
      : validateLowBalanceThreshold(toFiniteNumber(body.lowBalanceThreshold, "lowBalanceThreshold"));
  const withdrawalAlertDays =
    body.withdrawalAlertDays === undefined
      ? undefined
      : validateWithdrawalAlertDays(toFiniteNumber(body.withdrawalAlertDays, "withdrawalAlertDays"));
  let withdrawalAccountId: string | null | undefined;
  if (body.withdrawalAccountId !== undefined) {
    const id = body.withdrawalAccountId;
    if (id !== null && typeof id !== "string") {
      throw new Error("withdrawalAccountId は文字列か null で指定してください");
    }
    withdrawalAccountId = id === null || id === "" ? null : id;
  }
  const cardUpdates =
    body.cardWithdrawalLinks === undefined ? undefined : validateCardWithdrawalLinks(db, body.cardWithdrawalLinks);
  let credential: { loginId: string; password: string } | undefined;
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
    credential = resolveCrawlerCredential(db, cred.loginId, typeof rawPassword === "string" ? rawPassword : "");
  }

  // 2) 書込フェーズ: 検証を通った値だけを書く（ここで検証由来の例外は起きない）
  if (scheduledRefreshTime !== undefined) setScheduledRefreshTime(db, scheduledRefreshTime);
  if (lowBalanceThreshold !== undefined) setLowBalanceThreshold(db, lowBalanceThreshold);
  if (withdrawalAlertDays !== undefined) setWithdrawalAlertDays(db, withdrawalAlertDays);
  if (withdrawalAccountId !== undefined) setWithdrawalAccountId(db, withdrawalAccountId);
  if (cardUpdates !== undefined) applyCardWithdrawalLinks(db, cardUpdates);
  if (credential !== undefined) setCrawlerCredential(db, credential.loginId, credential.password);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length === 0) return {};
  return JSON.parse(text) as Record<string, unknown>;
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

export async function handleSettingsPut(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
  ensureMigrations(getDb());
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
  if (req.method === "POST" && url === "/dividends/sync") {
    // 手動トリガ。SyncResult をそのまま返す（部分失敗は errors に載る）
    try {
      const result = await syncDividends(getDb());
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (req.method === "POST" && url === "/dividends/mapping") {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid JSON body" });
      return;
    }
    const outcome = handleDividendMapping(getDb(), body);
    sendJson(res, outcome.status, outcome.body);
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
