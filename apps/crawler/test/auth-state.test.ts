/**
 * storageState の破棄と、セッション失効 1 回だけの自動リトライ。
 * Playwright は起動しない（runWithSessionRetry に渡す fn はテスト側の偽関数）。
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
let authStatePath: string;
/** env 差し替え後の fetchPage モジュール（server.js と同じインスタンスにして instanceOf を効かせる） */
let sessionExpired: new (url: string) => Error;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "auth-state-test-"));
  authStatePath = join(dir, "auth-state.json");
  process.env.AUTH_STATE_PATH = authStatePath;
  // AUTH_STATE_PATH はモジュール評価時に読まれるため、env 差し替え後に読み直す
  vi.resetModules();
  sessionExpired = (await import("../src/fetchPage.js")).SessionExpiredError;
});

afterEach(() => {
  delete process.env.AUTH_STATE_PATH;
  rmSync(dir, { recursive: true, force: true });
  vi.resetModules();
});

describe("invalidateStorageState", () => {
  it("storageState があれば削除する", async () => {
    const { invalidateStorageState } = await import("../src/auth.js");
    writeFileSync(authStatePath, "{}");
    expect(existsSync(authStatePath)).toBe(true);

    invalidateStorageState();

    expect(existsSync(authStatePath)).toBe(false);
  });

  it("storageState が無くても例外を投げない", async () => {
    const { invalidateStorageState } = await import("../src/auth.js");
    expect(existsSync(authStatePath)).toBe(false);

    expect(() => invalidateStorageState()).not.toThrow();
  });
});

describe("runWithSessionRetry", () => {
  it("SessionExpiredError なら 1 回だけ再実行し、storageState を捨てる", async () => {
    const { runWithSessionRetry } = await import("../src/server.js");
    writeFileSync(authStatePath, "{}");

    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new sessionExpired("https://ssnb.example/portfolio"))
      .mockResolvedValueOnce("ok");
    const retry = { hit: false };

    const result = await runWithSessionRetry("test", retry, fn);

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(retry.hit).toBe(true);
    expect(existsSync(authStatePath)).toBe(false);
  });

  it("2 回目も SessionExpiredError ならそのまま投げる（リトライは 1 回まで）", async () => {
    const { runWithSessionRetry } = await import("../src/server.js");
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new sessionExpired("https://ssnb.example/portfolio"));
    const retry = { hit: false };

    await expect(runWithSessionRetry("test", retry, fn)).rejects.toThrow("セッションが失効");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(retry.hit).toBe(true);
  });

  it("SessionExpiredError 以外はリトライしない", async () => {
    const { runWithSessionRetry } = await import("../src/server.js");
    const err = new Error("login failed");
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(err);
    const retry = { hit: false };

    await expect(runWithSessionRetry("test", retry, fn)).rejects.toThrow("login failed");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(retry.hit).toBe(false);
  });
});

describe("isUnauthenticatedUrl", () => {
  const load = () => import("../src/auth.js");

  it("sign_in は未認証", async () => {
    const { isUnauthenticatedUrl } = await load();
    expect(isUnauthenticatedUrl("https://ssnb.x.moneyforward.com/users/sign_in")).toBe(true);
  });

  it("2FA 未完了も未認証として扱う（ログイン済みと誤認すると取得が必ず失効する）", async () => {
    const { isUnauthenticatedUrl } = await load();
    expect(
      isUnauthenticatedUrl("https://ssnb.x.moneyforward.com/users/two_step_verifications"),
    ).toBe(true);
  });

  it("通常ページは認証済み", async () => {
    const { isUnauthenticatedUrl } = await load();
    expect(isUnauthenticatedUrl("https://ssnb.x.moneyforward.com/accounts")).toBe(false);
    expect(isUnauthenticatedUrl("https://ssnb.x.moneyforward.com/bs/portfolio")).toBe(false);
  });

  it("isTwoFactorUrl は 2FA 画面だけ true", async () => {
    const { isTwoFactorUrl } = await load();
    expect(isTwoFactorUrl("https://ssnb.x.moneyforward.com/users/two_step_verifications")).toBe(true);
    expect(isTwoFactorUrl("https://ssnb.x.moneyforward.com/users/sign_in")).toBe(false);
  });
});
