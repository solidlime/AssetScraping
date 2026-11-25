"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * 手動更新ボタン: crawler の :8766 POST /update を叩いてスクレイプを起動する。
 * CRAWLER_URL 環境変数（Next.js サーバ側）経由で呼ぶため、ブラウザからは
 * 自コンテナの API route (/api/update) を叩くだけ。所要 1〜2 分。
 */
export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleClick() {
    setRunning(true);
    setStatus("更新中… 1〜2分かかります");
    try {
      const res = await fetch("/api/update", { method: "POST" });
      // 409 = 既に別の更新（定期更新含む）が走っている。失敗ではなく待てばよい
      if (res.status === 409) {
        setStatus("他の更新が実行中です。終わるまで待ってから、もう一度");
        return;
      }
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (body.ok) {
        setStatus("更新しました");
        startTransition(() => router.refresh());
      } else {
        setStatus(`失敗: ${body.error ?? res.statusText}`);
      }
    } catch (err) {
      setStatus(`失敗: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={running || pending}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        今すぐ更新
      </button>
      {status && <span className="text-sm text-neutral-600">{status}</span>}
    </div>
  );
}
