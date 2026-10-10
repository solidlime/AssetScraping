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
import { resetOtp, waitForOtpCode } from "./otp.js";
import { createDb, getCrawlerCredential, resolveDbPath, type Database } from "@asset-scraping/db";

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
  constructor(message = "OTP 入力がタイムアウトしました。web UI から認証コードを入力して再実行してください。") {
    super(message);
    this.name = "TwoFactorRequiredError";
  }
}

export class LoginRequiredError extends Error {
  constructor(message = "ssnb のログインに失敗しました。認証情報 (設定タブ / SSNB_LOGIN_ID・SSNB_PASSWORD) とセレクタを確認してください。") {
    super(message);
    this.name = "LoginRequiredError";
  }
}

let credentialDb: Database | null = null;

/**
 * ssnb 認証情報を解決する: DB 設定 (app_settings) を優先し、無ければ
 * env (SSNB_LOGIN_ID / SSNB_PASSWORD) にフォールバック。どちらも無ければ null。
 */
export function loadCrawlerCredential(): { loginId: string; password: string } | null {
  if (!credentialDb) credentialDb = createDb({ path: resolveDbPath() });
  return getCrawlerCredential(credentialDb, {
    loginId: process.env.SSNB_LOGIN_ID,
    password: process.env.SSNB_PASSWORD,
  });
}

/** 2FA 画面かつ OTP 入力欄が表示されているか（本家 SELECTORS.mfidOtpInput 相当 + ssnb 実測値） */
export const OTP_INPUT_SELECTOR = [
  'input[autocomplete="one-time-code"]',
  'input[name*="otp"]',
  'input[name*="code"]',
  'input[name="verification_code"]',
  "#verification_code",
].join(", ");

export function isOtpInputVisible(page: Page): Promise<boolean> {
  return page
    .locator(OTP_INPUT_SELECTOR)
    .first()
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
}

/** OTP 待ち秒数（web UI からの入力を最大で待つ） */
export const OTP_WAIT_TIMEOUT_MS = Number(process.env.OTP_WAIT_TIMEOUT_MS ?? 5 * 60 * 1000);

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
        'input#sign_in_session_service_email',
        'input[name="sign_in_session_service[email]"]',
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
        'input#sign_in_session_service_password',
        'input[name="sign_in_session_service[password]"]',
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
        'input#login-btn-sumit',
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
  const credential = loadCrawlerCredential();
  if (!credential) {
    throw new Error(
      "ssnb の認証情報が未設定です。設定タブで登録するか、SSNB_LOGIN_ID / SSNB_PASSWORD を設定してください。",
    );
  }
  const { loginId, password } = credential;

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

  // 2FA（OTP 入力画面）検知: OTP 待ち状態をステータスファイルに出し、
  // web UI → crawler サーバ (POST /otp/submit) 経由で入力を受けてログイン続行する
  await sleep(2000);
  if (await isOtpInputVisible(page)) {
    console.log("[crawler] OTP 待ち: web UI から認証コードを入力してください");
    resetOtp();
    let code: string;
    try {
      code = await waitForOtpCode(OTP_WAIT_TIMEOUT_MS);
    } catch {
      await browser.close();
      throw new TwoFactorRequiredError();
    }
    await page.locator(OTP_INPUT_SELECTOR).first().fill(code);
    const otpSubmit = page
      .locator(
        [
          "#submitto",
          'button:text-is("認証する")',
          'button:text-is("Verify")',
          'input[type="submit"]',
          'button[type="submit"]',
        ].join(", "),
      )
      .first();
    if (await otpSubmit.count()) await otpSubmit.click();
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
    resetOtp();
  }

  // OTP 画面が出なかった場合のフォールバック（ヒント文案のみ）
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
