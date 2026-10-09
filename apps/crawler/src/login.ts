/**
 * 対話ログイン CLI。
 * 使い方: docker compose run --rm crawler npm run login
 * 成功すると /data/auth-state.json (storageState) に保存する。
 */
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { chromium } from "playwright";
import { AUTH_STATE_PATH, saveStorageState } from "./auth.js";
import { SSNB_URLS } from "@asset-scraping/shared";

async function main(): Promise<void> {
  const loginId = process.env.SSNB_LOGIN_ID;
  const password = process.env.SSNB_PASSWORD;
  if (!loginId || !password) {
    console.error("SSNB_LOGIN_ID / SSNB_PASSWORD が未設定です。");
    process.exit(1);
  }

  console.log("Chromium を起動します（headed）。ssnb のログイン画面を開きます…");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();

  await page.goto(SSNB_URLS.signIn, { waitUntil: "domcontentloaded" });

  // 認証情報を自動入力（失敗しても手動入力で続行できる）
  try {
    const email = page.locator('input[type="email"], input#user_email, input[name="user[email]"]').first();
    if (await email.count()) {
      await email.fill(loginId);
      const pass = page
        .locator('input[type="password"], input#user_password, input[name="user[password]"]')
        .first();
      if (await pass.count()) await pass.fill(password);
    }
  } catch {
    console.log("自動入力に失敗しました。手動で入力してください。");
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  await rl.question(
    `ブラウザでログインを完了させてください（2FA の場合はメール確認も）。\n完了したら Enter を押してください… `,
  );
  rl.close();

  if (page.url().includes("/users/sign_in")) {
    console.error("まだログインできていないようです（URL が sign_in のまま）。中断します。");
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

export { saveStorageState };
