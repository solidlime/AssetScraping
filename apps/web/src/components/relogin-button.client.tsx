"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";

/**
 * 再ログインボタン: crawler の :8766 POST /relogin を自コンテナの /api/relogin 経由で叩く。
 * crawler 側は storageState を捨ててフルログインし直し、そのままスクレイプを 1 回走らせる。
 */
export function ReloginButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/relogin", { method: "POST" });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (body.ok) startTransition(() => router.refresh());
      else setError(body.error ?? res.statusText);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || pending;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" size="sm" onClick={handleClick} disabled={disabled}>
        {disabled ? "再ログイン中…" : "再ログイン"}
      </Button>
      {error && <span className="text-sm text-red-700">再ログインに失敗: {error}</span>}
    </div>
  );
}
