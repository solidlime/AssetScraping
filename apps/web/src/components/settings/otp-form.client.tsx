"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface OtpStatusPayload {
  ok: boolean;
  status?: "idle" | "waiting" | "submitted";
  requestedAt?: string;
  expiresAt?: string;
  error?: string;
}

/**
 * 2FA（OTP）入力フォーム。crawler のスクレイプ中に 2FA 画面が検出されると
 * crawler が OTP 待ち状態 (GET /otp/status → waiting) になるため、
 * 3 秒間隔でポーリングして waiting ならフォームを表示する。
 * 入力後 POST /api/otp/submit → crawler がコードを fill してログイン続行する。
 */
export function OtpForm() {
  const [phase, setPhase] = useState<"idle" | "waiting" | "submitted">("idle");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const submittingRef = useRef(false);

  const poll = useCallback(async () => {
    // submit 中はポーリングで waiting を上書きしない
    if (submittingRef.current) return;
    try {
      const res = await fetch("/api/otp");
      const body = (await res.json()) as OtpStatusPayload;
      if (body.ok && (body.status === "waiting" || body.status === "submitted")) {
        setPhase("waiting");
        setExpiresAt(body.expiresAt ?? null);
      } else {
        setPhase("idle");
        setExpiresAt(null);
      }
    } catch {
      // crawler 未起動などは無視（次の tick で再試行）
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void poll(), 3000);
    void poll();
    return () => clearInterval(timer);
  }, [poll]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setSubmitting(true);
    submittingRef.current = true;
    setMessage(null);
    try {
      const res = await fetch("/api/otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (body.ok) {
        setCode("");
        setMessage({ kind: "ok", text: "認証コードを送信しました。ログイン続行を待っています…" });
      } else {
        setMessage({ kind: "error", text: `送信失敗: ${body.error ?? res.statusText}` });
      }
    } catch (err) {
      setMessage({ kind: "error", text: `送信失敗: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      void poll();
    }
  }

  if (phase !== "waiting") return null;

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="text-sm font-medium">2段階認証コードの入力が必要です</div>
      <p className="text-xs text-muted-foreground">
        更新処理中に ssnb の認証コード確認画面が検出されました。登録メールアドレスに届いたコードを入力してください。
        {expiresAt ? `（受付期限: ${new Date(expiresAt).toLocaleTimeString("ja-JP")}）` : ""}
      </p>
      <div className="flex items-center gap-2">
        <Input
          type="text"
          inputMode="numeric"
          placeholder="認証コード"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={submitting}
          className="max-w-40"
          autoFocus
        />
        <Button type="submit" disabled={submitting || code.trim().length === 0}>
          送信
        </Button>
      </div>
      {message && (
        <span className={`text-xs ${message.kind === "ok" ? "text-green-600" : "text-red-600"}`}>
          {message.text}
        </span>
      )}
    </form>
  );
}
