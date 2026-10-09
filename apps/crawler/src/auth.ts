/**
 * ssnb ログイン・セッション管理。
 *
 * - storageState (auth-state.json) が有効ならセッション検証のみ
 * - 失効時はフルログイン。2FA（メール確認型）を検知したら明示エラーで停止
 *   （黙って空データを書かない）
 */
import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { SSNB_URLS } from "@asset-scraping/shared";

export const AUTH_STATE_PATH =
  process.env.AUTH_STATE_PATH ?? "/data/auth-state.json";

/** ssnb にログイン済みかどうかを判定するための URL（要認証ページ） */
const SESSION_CHECK_URL = SSNB_URLS.portfolio;

/** 2FA / メール確認画面の兆候 */
const TWO_FACTOR_HINTS = [
  "確認コード",
  "認証コード",
  "ワンタイム",
  "one-time",
  "verification code",
  "confirm your",
  "二段階認証",
];

export class TwoFactorRequiredError extends Error {
  constructor(message = "ssnb がメール確認（2FA）を要求しました。自動化できません。`npm run login` で対話ログインして storageState を更新してください。") {
    super(message);
    this.name = "TwoFactorRequiredError";
  }
}

export class LoginRequiredError extends Error {
  constructor(message = "ssnb のログインに失敗しました。認証情報 (SSNB_LOGIN_ID / SSNB_PASSWORD) とセレクタを確認してください。") {
    super(message);
    this.name = "LoginRequiredError";
  }
}

export interface Session {
  context: BrowserContext;
  page: Page;
  browser: Browser;
  /** フルログインが発生したか（storageState が失効していた等） */
  didFullLogin: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function storageStateExists(): boolean {
  try {
    return statSync(AUTH_STATE_PATH).isFile();
  } catch {
    return false;
  }
}

async function isLoggedIn(page: Page): Promise<boolean> {
  const res = await page.goto(SESSION_CHECK_URL, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  // Rails は未認証だと 302 → /users/sign_in に飛ぶ
  if (page.url().includes("/users/sign_in")) return false;
  if (res && res.status() >= 400) return false;
  return true;
}

function containsTwoFactorHint(text: string): boolean {
  const lower = text.toLowerCase();
  return TWO_FACTOR_HINTS.some((h) => lower.includes(h.toLowerCase()));
}

/**
 * MFID ログイン実装（mf-dashboard 踏襲）を ssnb 向けに堅牢化したもの。
 * id/name 属性と type ベースのフォールバックでメール・パスワード欄を探す。
 */
async function fillCredentials(page: Page, loginId: string, password: string): Promise<void> {
  await page.goto(SSNB_URLS.signIn, { waitUntil: "domcontentloaded", timeout: 30_000 });

  const emailInput = page
    .locator(
      [
        'input#user_email',
        'input[name="user[email]"]',
        'input[name="email"]',
        'input[type="email"]',
      ].join(", "),
    )
    .first();
  const passwordInput = page
    .locator(
      [
        'input#user_password',
        'input[name="user[password]"]',
        'input[name="password"]',
        'input[type="password"]',
      ].join(", "),
    )
    .first();

  if ((await emailInput.count()) === 0 || (await passwordInput.count()) === 0) {
    throw new LoginRequiredError(
      "ログインフォームの入力欄が見つかりませんでした。SSNB_URLS.signIn の HTML を実測してセレクタを調整してください。",
    );
  }

  await emailInput.fill(loginId);
  await sleep(300);
  await passwordInput.fill(password);
  await sleep(300);

  const submit = page
    .locator(
      [
        'input[type="submit"][value*="ログイン"]',
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("ログイン")',
      ].join(", "),
    )
    .first();
  await submit.click();
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
}

/**
 * 認証済みセッションを取得する。
 * - storageState が有効 → そのまま再利用
 * - 失効 → SSNB_LOGIN_ID / SSNB_PASSWORD でフルログイン
 * - 2FA 要求 → TwoFactorRequiredError で停止
 */
export async function getSession(headless = true): Promise<Session> {
  const loginId = process.env.SSNB_LOGIN_ID;
  const password = process.env.SSNB_PASSWORD;
  if (!loginId || !password) {
    throw new Error("SSNB_LOGIN_ID / SSNB_PASSWORD が未設定です（.env を確認）。");
  }

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    ...(storageStateExists() ? { storageState: AUTH_STATE_PATH } : {}),
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  let didFullLogin = false;

  if (await isLoggedIn(page)) {
    return { context, page, browser, didFullLogin };
  }

  // フルログイン
  await fillCredentials(page, loginId, password);

  // 2FA（メール確認型）検知
  await sleep(2000);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (page.url().includes("/users/sign_in") || containsTwoFactorHint(bodyText)) {
    if (containsTwoFactorHint(bodyText)) {
      await browser.close();
      throw new TwoFactorRequiredError();
    }
    await browser.close();
    throw new LoginRequiredError(
      "ログイン後も sign_in に滞留しています。認証情報が不正か、フォーム構造が変わった可能性があります。",
    );
  }

  if (!(await isLoggedIn(page))) {
    await browser.close();
    throw new LoginRequiredError("ログイン処理後に認証状態を確認できませんでした。");
  }

  didFullLogin = true;
  return { context, page, browser, didFullLogin };
}

/** storageState を保存する */
export async function saveStorageState(session: Session): Promise<void> {
  mkdirSync(dirname(AUTH_STATE_PATH), { recursive: true });
  await session.context.storageState({ path: AUTH_STATE_PATH });
}

export async function closeSession(session: Session): Promise<void> {
  await session.context.close().catch(() => {});
  await session.browser.close().catch(() => {});
}
