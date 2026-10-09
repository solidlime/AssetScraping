/**
 * fetchPage 抽象化: SSR の HTML を page.content() で取得する。
 * 規約遵守のためページ取得間に 1-3 秒スリープを挟む。
 */
import type { Page } from "playwright";
import { SLEEP_RANGE_MS, SSNB_BASE_URL } from "@asset-scraping/shared";

export class FetchPage {
  private lastFetchAt = 0;

  constructor(
    private readonly page: Page,
    private readonly sleepRange: { min: number; max: number } = SLEEP_RANGE_MS,
  ) {}

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastFetchAt;
    const wait =
      this.sleepRange.min + Math.random() * (this.sleepRange.max - this.sleepRange.min);
    if (elapsed < wait) {
      await new Promise((r) => setTimeout(r, wait - elapsed));
    }
  }

  /**
   * URL を開いて HTML 文字列を返す。絶対 URL も ssnb ルート相対パスも可。
   */
  async fetch(url: string): Promise<string> {
    const full = url.startsWith("http") ? url : new URL(url, SSNB_BASE_URL).toString();
    await this.throttle();
    const res = await this.page.goto(full, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (!res || res.status() >= 400) {
      throw new Error(`fetch failed: ${full} (status=${res?.status() ?? "null"})`);
    }
    if (this.page.url().includes("/users/sign_in")) {
      throw new SessionExpiredError(full);
    }
    this.lastFetchAt = Date.now();
    return this.page.content();
  }

  /** 現在のページの HTML を取得（遷移なし） */
  async currentContent(): Promise<string> {
    return this.page.content();
  }
}

export class SessionExpiredError extends Error {
  constructor(url: string) {
    super(`セッションが失効しています (redirect to /users/sign_in while fetching ${url})。npm run login で再ログインしてください。`);
    this.name = "SessionExpiredError";
  }
}
