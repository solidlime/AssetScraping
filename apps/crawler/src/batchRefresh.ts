/**
 * SSNB の「金融機関からのデータ一括更新」をクリックする。
 * リンクは /accounts 上の ga-batch-refresh-button。/faggregation_queue2 への素の GET は 500 に
 * なることがあるため、必ずリンククリックで押す（クリックすると /accounts のまま各行が「更新中」になる）。
 * 押せたら true、ボタンが見つからなければ false。
 */
import type { Page } from "playwright";
import { SSNB_URLS } from "@asset-scraping/shared";

const LABEL = "金融機関からのデータ一括更新";

export async function pressBatchRefresh(page: Page): Promise<boolean> {
  await page.goto(SSNB_URLS.accounts, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const link = page.getByRole("link", { name: LABEL });
  if ((await link.count()) === 0) return false;
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => null),
    link.first().click(),
  ]);
  return true;
}
