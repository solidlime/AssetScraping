/**
 * app_settings (key-value) リポジトリ。
 * 本家に設定タブは無い（env / crontab 管理）。AssetScraping は WEB UI で完結するため、
 * 定期更新時刻・残高しきい値・ログイン認証情報を DB に持つ。
 * crawler が唯一の書き込み側（web は proxy、mcp は read-only）。
 */
import { eq } from "drizzle-orm";
import type { Database } from "../client.ts";
import { appSettings } from "../schema.ts";

/** 本家 LOW_BALANCE_THRESHOLD（account-notifications-data.ts）と同じ既定値 */
export const DEFAULT_LOW_BALANCE_THRESHOLD = 100_000;
/** 本家 crontab の定期更新時刻相当（6:00 JST。本家は 6:30 / 15:30 の 2 本） */
export const DEFAULT_SCHEDULED_REFRESH_TIME = "06:00";

export const SETTING_KEYS = {
  lowBalanceThreshold: "low_balance_threshold",
  scheduledRefreshTime: "scheduled_refresh_time",
  ssnbLoginId: "ssnb_login_id",
  ssnbPassword: "ssnb_password",
} as const;

export function getSetting(db: Database, key: string): string | null {
  const row = db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .get();
  return row?.value ?? null;
}

export function setSetting(db: Database, key: string, value: string): void {
  const ts = new Date().toISOString();
  db.insert(appSettings)
    .values({ key, value, createdAt: ts, updatedAt: ts })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: ts },
    })
    .run();
}

export function deleteSetting(db: Database, key: string): void {
  db.delete(appSettings).where(eq(appSettings.key, key)).run();
}

/** しきい値を数値で取得。未設定・非数値・負値は既定値にフォールバック */
export function getLowBalanceThreshold(db: Database): number {
  const raw = getSetting(db, SETTING_KEYS.lowBalanceThreshold);
  if (raw === null) return DEFAULT_LOW_BALANCE_THRESHOLD;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LOW_BALANCE_THRESHOLD;
}

export function setLowBalanceThreshold(db: Database, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`しきい値は 0 以上の数値で指定してください: ${value}`);
  }
  setSetting(db, SETTING_KEYS.lowBalanceThreshold, String(Math.round(value)));
}

/** "HH:MM" (JST) を正規化する。"6:5" → "06:05"。解釈不能は null */
export function normalizeScheduleTime(raw: string): string | null {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** 定期更新時刻 "HH:MM" を取得。未設定・不正値は既定値にフォールバック */
export function getScheduledRefreshTime(db: Database): string {
  const raw = getSetting(db, SETTING_KEYS.scheduledRefreshTime);
  return raw === null ? DEFAULT_SCHEDULED_REFRESH_TIME : (normalizeScheduleTime(raw) ?? DEFAULT_SCHEDULED_REFRESH_TIME);
}

export function setScheduledRefreshTime(db: Database, value: string): void {
  const normalized = normalizeScheduleTime(value);
  if (normalized === null) {
    throw new Error(`時刻は HH:MM (JST) 形式で指定してください: ${value}`);
  }
  setSetting(db, SETTING_KEYS.scheduledRefreshTime, normalized);
}

/**
 * ssnb ログイン認証情報を取得。DB に両方揃っていればそれを、
 * 無ければ env (SSNB_LOGIN_ID / SSNB_PASSWORD) フォールバック。どちらも無ければ null。
 */
export function getCrawlerCredential(
  db: Database,
  env: { loginId?: string; password?: string } = {},
): { loginId: string; password: string } | null {
  const dbId = getSetting(db, SETTING_KEYS.ssnbLoginId);
  const dbPassword = getSetting(db, SETTING_KEYS.ssnbPassword);
  if (dbId !== null && dbPassword !== null) {
    return { loginId: dbId, password: dbPassword };
  }
  if (env.loginId && env.password) {
    return { loginId: env.loginId, password: env.password };
  }
  return null;
}

/** 認証情報を登録・変更（パスワードが空文字の場合は既存値を保持する） */
export function setCrawlerCredential(db: Database, loginId: string, password: string): void {
  const prevPassword = getSetting(db, SETTING_KEYS.ssnbPassword);
  const nextPassword = password.length > 0 ? password : prevPassword;
  if (nextPassword === null || nextPassword.length === 0) {
    throw new Error("パスワードが未設定です（空文字指定時は既存パスワードが必要）");
  }
  setSetting(db, SETTING_KEYS.ssnbLoginId, loginId);
  setSetting(db, SETTING_KEYS.ssnbPassword, nextPassword);
}
