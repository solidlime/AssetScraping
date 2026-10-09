/**
 * WebUI ログイン（noVNC 経由）。
 * 使い方: docker compose up login-web → ホストブラウザで http://localhost:8767/vnc.html を開く。
 * 表示された Chromium で ssnb にログインする（2FA コードはメール確認→画面で入力）。
 * ログイン完了を検出したら storageState を /data/auth-state.json に保存して終了する。
 */
import { chromium } from "playwright";
import { AUTH_STATE_PATH } from "./auth.js";
import { SSNB_URLS } from "@asset-scraping/shared";

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;

function isLoggedIn(url: string): boolean {
  return !url.includes("/users/sign_in") && !url.includes("/two_step_verifications");
}

async function main(): Promise<void> {
  const loginId = process.env.SSNB_LOGIN_ID;
  const password = process.env.SSNB_PASSWORD;
  if (!loginId || !password) {
    console.error("SSNB_LOGIN_ID / SSNB_PASSWORD が未設定です（.env を確認）。");
    process.exit(1);
  }

  console.log("noVNC 経由で Chromium を起動します。ホストから http://localhost:8767/vnc.html を開いてください。");
  const browser = await chromium.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1280,800"],
  });
  const context = await browser.newContext({
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  await page.goto(SSNB_URLS.signIn, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);

  // 認証情報を自動入力してログイン。失敗しても画面から手動入力できるので続行
  try {
    const email = page
      .locator(
        'input#sign_in_session_service_email, input[name="sign_in_session_service[email]"], input[type="email"]',
      )
      .first();
    if (await email.count()) {
      await email.fill(loginId);
      const pass = page
        .locator(
          'input#sign_in_session_service_password, input[name="sign_in_session_service[password]"], input[type="password"]',
        )
        .first();
      if (await pass.count()) await pass.fill(password);
      const submit = page
        .locator('input#login-btn-sumit, input[type="submit"][value*="ログイン"], button[type="submit"]')
        .first();
      if (await submit.count()) {
        await submit.click();
        console.log("認証情報を送信しました。2FA が要求された場合は、登録メールの確認コードを noVNC 画面で入力してください。");
      }
    }
  } catch {
    console.log("自動入力できませんでした。noVNC 画面から手動で入力してください。");
  }

  // ログイン完了（sign_in / two_step_verifications から離脱）を監視
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let done = false;
  while (Date.now() < deadline) {
    try {
      if (isLoggedIn(page.url())) {
        done = true;
        break;
      }
    } catch {
      // ページ遷移中の一時的エラーは無視して再試行
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  if (!done) {
    console.error("タイムアウト: 10分以内にログインが完了しませんでした。");
    await browser.close();
    process.exit(1);
  }

  // 遷移が落ち着くのを待ってから storageState を保存
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });
  } catch {
    // 保存は続行
  }
  await page.waitForTimeout(3000);
  await context.storageState({ path: AUTH_STATE_PATH });
  console.log(`ログイン完了。storageState を保存しました: ${AUTH_STATE_PATH}`);
  console.log("5秒後にブラウザを閉じます…");
  await page.waitForTimeout(5000);
  await browser.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
