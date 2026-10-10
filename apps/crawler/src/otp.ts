/**
 * 2段階認証（OTP）待ち状態ストア。
 *
 * - 待ち状態はステータスファイル (JSON) に永続化 → crawler サーバ・CLI login など
 *   プロセスをまたいで web UI から状態参照・コード投入が可能
 * - 同プロセスの待ち手には resolver で即時解決、別プロセス（CLI）は
 *   ポーリングで submitted + code を検知する
 * - DB (app_settings) は使わない（設定タブ実装と競合しないようファイル方式）
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { AUTH_STATE_PATH } from "./auth.js";

export type OtpPhase = "idle" | "waiting" | "submitted";

export interface OtpStatus {
  status: OtpPhase;
  /** waiting 開始時刻 (ISO) */
  requestedAt?: string;
  /** waiting 打ち切り時刻 (ISO) */
  expiresAt?: string;
  /** submitted 済みコード（外部プロセスの待ち手が読む） */
  code?: string;
}

/** OTP 待ちタイムアウト */
export class OtpTimeoutError extends Error {
  constructor(message = "OTP 入力がタイムアウトしました。web UI から認証コードを入力してください。") {
    super(message);
    this.name = "OtpTimeoutError";
  }
}

export interface OtpOptions {
  /** ステータスファイルパス。既定: AUTH_STATE_PATH と同ディレクトリの otp-state.json */
  statePath?: string;
  /** ファイルポーリング間隔 ms（待ち手側）。既定 250 */
  pollMs?: number;
}

export function defaultOtpStatePath(): string {
  return process.env.OTP_STATE_PATH ?? `${dirname(AUTH_STATE_PATH).replace(/\\/g, "/")}/otp-state.json`;
}

function resolvePath(opts: OtpOptions = {}): string {
  return opts.statePath ?? defaultOtpStatePath();
}

function readState(opts: OtpOptions): OtpStatus {
  try {
    const raw = JSON.parse(readFileSync(resolvePath(opts), "utf8")) as OtpStatus;
    if (typeof raw?.status !== "string") return { status: "idle" };
    return raw;
  } catch {
    return { status: "idle" };
  }
}

function writeState(state: OtpStatus, opts: OtpOptions): void {
  const path = resolvePath(opts);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state), "utf8");
}

export function getOtpStatus(opts: OtpOptions = {}): OtpStatus {
  return readState(opts);
}

export function resetOtp(opts: OtpOptions = {}): void {
  waiter = null;
  writeState({ status: "idle" }, opts);
}

/** 同プロセスの待ち手（ことを期待するが、本来はワンショットで解決する） */
let waiter: ((code: string) => void) | null = null;

/** OTP を投入する。同プロセス待ち手がいれば true（即時解決）、いなければ false（ファイルに残す） */
export function submitOtpCode(code: string, opts: OtpOptions = {}): boolean {
  const current = readState(opts);
  const state: OtpStatus = { ...current, status: "submitted", code: code.trim() };
  const w = waiter;
  writeState(state, opts);
  if (w !== null) {
    w(code.trim());
    waiter = null;
    return true;
  }
  return false;
}

/** OTP コード待ち。waiting 状態をファイルに出し、resolver / ファイル監視 / タイムアウトで解決する */
export function waitForOtpCode(timeoutMs: number, opts: OtpOptions = {}): Promise<string> {
  const now = new Date();
  const pollMs = opts.pollMs ?? 250;

  if (waiter !== null || readState(opts).status === "waiting") {
    return Promise.reject(new Error("OTP 入力待ちが既に実行中です (already waiting)"));
  }

  writeState(
    {
      status: "waiting",
      requestedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + timeoutMs).toISOString(),
    },
    opts,
  );

  // ファイル起点の解決（別プロセスの submitOtpCode を検知）。開始直前の submitted は無視したいが、
  // この関数は waiting を書いた直後に監視するため、自分より前の submitted は消化済みとみなして採用する。

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiter = null;
      clearInterval(interval);
      reject(new OtpTimeoutError());
    }, timeoutMs);

    const tryFile = (): void => {
      const s = readState(opts);
      if (s.status === "submitted" && s.code) {
        clearTimeout(timer);
        clearInterval(interval);
        resolve(s.code);
      }
    };
    const interval = setInterval(tryFile, pollMs);

    waiter = (code: string) => {
      clearTimeout(timer);
      clearInterval(interval);
      resolve(code);
    };
  });
}
