"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/button";
import { FormField } from "../ui/form-field";
import { Input } from "../ui/input";

interface SettingsPayload {
  ok: boolean;
  scheduledRefreshTime?: string;
  lowBalanceThreshold?: number;
  credential?: { loginId: string; hasPassword: boolean };
  error?: string;
}

/**
 * 設定タブの中身。crawler (:8766 /settings) を /api/settings 経由で読み書きする。
 * - 定期更新時刻（HH:MM JST、既定 06:00）
 * - 残高しきい値（口座一覧の警告バッジ・getAccountAlerts と共通の設定値）
 * - ssnb 認証情報（パスワードはマスク表示・空欄なら既存値を保持）
 */
export function SettingsForm() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [scheduledRefreshTime, setScheduledRefreshTime] = useState("06:00");
  const [lowBalanceThreshold, setLowBalanceThreshold] = useState<number>(100_000);
  const [loginId, setLoginId] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [password, setPassword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings");
      const body = (await res.json()) as SettingsPayload;
      if (body.ok) {
        setScheduledRefreshTime(body.scheduledRefreshTime ?? "06:00");
        setLowBalanceThreshold(
          typeof body.lowBalanceThreshold === "number" && Number.isFinite(body.lowBalanceThreshold)
            ? body.lowBalanceThreshold
            : 100_000,
        );
        setLoginId(body.credential?.loginId ?? "");
        setHasPassword(body.credential?.hasPassword ?? false);
      } else {
        setMessage({ kind: "error", text: `読み込み失敗: ${body.error ?? res.statusText}` });
      }
    } catch (err) {
      setMessage({ kind: "error", text: `読み込み失敗: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(payload: Record<string, unknown>, successText: string) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as SettingsPayload;
      if (body.ok) {
        if (body.scheduledRefreshTime) setScheduledRefreshTime(body.scheduledRefreshTime);
        if (typeof body.lowBalanceThreshold === "number") setLowBalanceThreshold(body.lowBalanceThreshold);
        if (body.credential) {
          setLoginId(body.credential.loginId);
          setHasPassword(body.credential.hasPassword);
        }
        setPassword("");
        setMessage({ kind: "ok", text: successText });
      } else {
        setMessage({ kind: "error", text: `保存失敗: ${body.error ?? res.statusText}` });
      }
    } catch (err) {
      setMessage({ kind: "error", text: `保存失敗: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">読み込み中…</p>;
  }

  return (
    <div className="space-y-6">
      {message && (
        <p className={message.kind === "ok" ? "text-sm text-green-600" : "text-sm text-destructive"}>
          {message.text}
        </p>
      )}

      <FormField
        label="定期更新時刻（JST）"
        htmlFor="scheduled-refresh-time"
        description="毎日この時刻に自動でスクレイプを実行します。既定は 06:00。"
      >
        <div className="flex items-center gap-2">
          <Input
            id="scheduled-refresh-time"
            type="time"
            value={scheduledRefreshTime}
            onChange={(e) => setScheduledRefreshTime(e.target.value)}
            className="w-32"
            disabled={saving}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={saving || scheduledRefreshTime === "" || scheduledRefreshTime.length > 5}
            onClick={() => save({ scheduledRefreshTime }, "定期更新時刻を保存しました")}
          >
            時刻を保存
          </Button>
        </div>
      </FormField>

      <FormField
        label="残高しきい値（円）"
        htmlFor="low-balance-threshold"
        description="この値以下の残高の口座を、口座一覧に低残高警告として表示します。既定は 100,000。"
      >
        <div className="flex items-center gap-2">
          <Input
            id="low-balance-threshold"
            type="number"
            min={0}
            step={1000}
            value={lowBalanceThreshold}
            onChange={(e) => setLowBalanceThreshold(Number(e.target.value))}
            className="w-40"
            disabled={saving}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={saving || !Number.isFinite(lowBalanceThreshold) || lowBalanceThreshold < 0}
            onClick={() => save({ lowBalanceThreshold }, "残高しきい値を保存しました")}
          >
            しきい値を保存
          </Button>
        </div>
      </FormField>

      <FormField
        label="ssnb ログイン ID"
        htmlFor="ssnb-login-id"
        description="ssnb にログインする際の ID。未入力の場合は環境変数 (SSNB_LOGIN_ID) が使われます。"
      >
        <div className="flex items-center gap-2">
          <Input
            id="ssnb-login-id"
            type="text"
            autoComplete="off"
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            className="w-72"
            placeholder="user@example.com"
            disabled={saving}
          />
        </div>
      </FormField>

      <FormField
        label="ssnb パスワード"
        htmlFor="ssnb-password"
        description={
          hasPassword
            ? "登録済み。変更する場合のみ入力してください（空欄なら現在のパスワードを保持します）。"
            : "未登録。環境変数 (SSNB_PASSWORD) が使われます。登録すると UI からの変更が有効になります。"
        }
      >
        <div className="flex items-center gap-2">
          <Input
            id="ssnb-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-72"
            placeholder={hasPassword ? "••••••••" : "未登録"}
            disabled={saving}
          />
          <Button
            disabled={saving || loginId.trim() === ""}
            onClick={() => save({ credential: { loginId: loginId.trim(), password } }, "認証情報を保存しました")}
          >
            認証情報を保存
          </Button>
        </div>
      </FormField>
    </div>
  );
}
