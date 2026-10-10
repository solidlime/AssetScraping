/**
 * 対話ログイン CLI。
 * 使い方: docker compose run --rm crawler npm run login
 * 成功すると /data/auth-state.json (storageState) に保存する。
 *
 * フロー: 自動入力 → 自動ログイン → 2FA（メール確認コード）なら CLI でコード入力 → storageState 保存
 */
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { chromium } from "playwright";
import type { Page } from "playwright";
import { AUTH_STATE_PATH, loadCrawlerCredential } from "./auth.js";
import { SSNB_URLS } from "@asset-scraping/shared";

/** 2FA 画面かどうか */
function isTwoFactorPage(url: string): boolean {
  return url.includes("/users/two_step_verifications");
}

/** 2FA コードを CLI から入力して送信する */
async function completeTwoFactor(page: Page, rl: readline.Interface): Promise<void> {
  console.log("2段階認証が要求されました。登録メールアドレスに確認コードを送ります…");
  // 「確認コードを再送」ではなく、ログイン直後に自動送信されている場合はそのまま入力へ
  const code = await rl.question("メールに届いた認証コードを入力してください: ");
  await page.locator('input[name="verification_code"], #verification_code').first().fill(code.trim());
  await page.locator('input[type="submit"][value*="認証"], .form-submit-code').first().click();
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
}

async function main(): Promise<void> {
  const credential = loadCrawlerCredential();
  if (!credential) {
    console.error("ssnb の認証情報が未設定です。設定タブで登録するか、SSNB_LOGIN_ID / SSNB_PASSWORD を設定してください。");
    process.exit(1);
  }
  const { loginId, password } = credential;

  // CI/コンテナ内では X server が無いので headless で起動（HEADLESS=0 で上書き可）
  const headed = process.env.HEADLESS === "0";
  console.log(`Chromium を起動します（${headed ? "headed" : "headless"}）。ssnb のログイン画面を開きます…`);
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  await page.goto(SSNB_URLS.signIn, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);

  // 認証情報を自動入力してログイン（失敗したら手動入力で続行）
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
        await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
      }
    } else {
      console.log("ログインフォームが見つかりません。手動で入力してください。");
    }
  } catch {
    console.log("自動入力に失敗しました。手動で入力してください。");
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  // 2FA 画面なら CLI でコード入力を促す
  if (isTwoFactorPage(page.url())) {
    await completeTwoFactor(page, rl);
    if (isTwoFactorPage(page.url())) {
      console.error("認証コードが受理されませんでした（URL が two_step_verifications のまま）。中断します。");
      await browser.close();
      process.exit(1);
    }
  }

  // 最終確認: 未ログインなら手動 completing を促す
  if (page.url().includes("/users/sign_in")) {
    await rl.question(
      `まだログインできていないようです。ブラウザ出力は見えませんが、HEADLESS=0 なら画面で操作できます。\n手動完了後、Enter を押してください… `,
    );
  }
  rl.close();

  if (page.url().includes("/users/sign_in") || isTwoFactorPage(page.url())) {
    console.error(`ログインが完了していません（url: ${page.url()}）。中断します。`);
    await browser.close();
    process.exit(1);
  }

  // storageState を保存
  await context.storageState({ path: AUTH_STATE_PATH });
  console.log(`storageState を保存しました: ${AUTH_STATE_PATH}`);
  await browser.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
