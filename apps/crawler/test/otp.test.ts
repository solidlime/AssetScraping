import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OtpTimeoutError,
  getOtpStatus,
  resetOtp,
  submitOtpCode,
  waitForOtpCode,
  type OtpOptions,
} from "../src/otp.js";

let dir: string;
let opts: OtpOptions;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "otp-test-"));
  opts = { statePath: join(dir, "otp-state.json"), pollMs: 20 };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("getOtpStatus", () => {
  it("初期状態は idle", () => {
    expect(getOtpStatus(opts)).toEqual({ status: "idle" });
  });
});

describe("waitForOtpCode / submitOtpCode（同プロセス解決）", () => {
  it("waiting 状態になり、submitOtpCode で解決する", async () => {
    const pending = waitForOtpCode(1000, opts);
    const status = getOtpStatus(opts);
    expect(status.status).toBe("waiting");
    expect(status.requestedAt).toBeTruthy();
    expect(status.expiresAt).toBeTruthy();

    expect(submitOtpCode("123456", opts)).toBe(true);
    expect(getOtpStatus(opts).status).toBe("submitted");
    await expect(pending).resolves.toBe("123456");
  });

  it("submit 後の resetOtp で idle に戻る", async () => {
    const pending = waitForOtpCode(1000, opts);
    submitOtpCode("654321", opts);
    await pending;
    resetOtp(opts);
    expect(getOtpStatus(opts)).toEqual({ status: "idle" });
  });

  it("タイムアウトで OtpTimeoutError", async () => {
    await expect(waitForOtpCode(60, opts)).rejects.toThrow(OtpTimeoutError);
  });

  it("タイムアウト後も waiting が残り、遅れて届いたコードで解決しない（presolved チェック）", async () => {
    const pending = waitForOtpCode(60, opts).catch((e) => e);
    await new Promise((r) => setTimeout(r, 100));
    submitOtpCode("999999", opts);
    const err = await pending;
    expect(err).toBeInstanceOf(OtpTimeoutError);
  });

  it("二重待ちはエラー", async () => {
    const first = waitForOtpCode(1000, opts);
    await expect(waitForOtpCode(1000, opts)).rejects.toThrow(/already/i);
    submitOtpCode("111111", opts);
    await first;
  });
});

describe("submitOtpCode（待ち手が無い場合）", () => {
  it("待ち手がいなくてもコードをファイルに残す（CLI プロセス間連携用）", () => {
    expect(submitOtpCode("222222", opts)).toBe(false);
    expect(getOtpStatus(opts)).toMatchObject({ status: "submitted" });
  });

  it("waiting 中なら true（即時解決）", async () => {
    const pending = waitForOtpCode(1000, opts);
    expect(submitOtpCode("333333", opts)).toBe(true);
    await pending;
  });
});
