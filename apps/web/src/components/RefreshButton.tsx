"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * 手動更新ボタン: crawler の :8766 POST /update を叩いてスクレイプを起動する。
 * CRAWLER_URL 環境変数（Next.js サーバ側）経由で呼ぶため、ブラウザからは
 * 自コンテナの API route (/api/update) を叩くだけ。
 */
export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  async function handleClick() {
    setStatus("更新中… 数十秒かかることがあります");
    try {
      const res = await fetch("/api/update", { method: "POST" });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (body.ok) {
        setStatus("更新しました");
        startTransition(() => router.refresh());
      } else {
        setStatus(`失敗: ${body.error ?? res.statusText}`);
      }
    } catch (err) {
      setStatus(`失敗: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending || status === "更新中… 数十秒かかることがあります"}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        今すぐ更新
      </button>
      {status && <span className="text-sm text-neutral-600">{status}</span>}
    </div>
  );
}
