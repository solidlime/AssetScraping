"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/button";
import { FormField } from "../ui/form-field";
import { Input } from "../ui/input";
import { Select } from "../ui/select";

interface SettingsPayload {
  ok: boolean;
  scheduledRefreshTime?: string;
  lowBalanceThreshold?: number;
  withdrawalAlertDays?: number;
  withdrawalAccountId?: string | null;
  credential?: { loginId: string; hasPassword: boolean };
  error?: string;
}

/** 未設定を表す UI 側のセンチネル（空文字を Select に渡さないため） */
const NO_ACCOUNT = "none";

/**
 * 設定タブの中身。crawler (:8766 /settings) を /api/settings 経由で読み書きする。
 * - 定期更新時刻（HH:MM JST、既定 06:00）
 * - 残高しきい値（口座一覧の警告バッジ・getAccountAlerts と共通の設定値）
 * - クレカ引き落とし警告の日数 N と引き落とし口座（F7）
 * - ssnb 認証情報（パスワードはマスク表示・空欄なら既存値を保持）
 */
export function SettingsForm({ withdrawalAccounts }: { withdrawalAccounts: { id: string; name: string }[] }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [scheduledRefreshTime, setScheduledRefreshTime] = useState("06:00");
  const [lowBalanceThreshold, setLowBalanceThreshold] = useState<number>(100_000);
  const [withdrawalAlertDays, setWithdrawalAlertDays] = useState<number>(7);
  const [withdrawalAccountId, setWithdrawalAccountId] = useState<string>(NO_ACCOUNT);
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
        setWithdrawalAlertDays(
          typeof body.withdrawalAlertDays === "number" && Number.isFinite(body.withdrawalAlertDays)
            ? body.withdrawalAlertDays
            : 7,
        );
        setWithdrawalAccountId(body.withdrawalAccountId ?? NO_ACCOUNT);
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
        if (typeof body.withdrawalAlertDays === "number") setWithdrawalAlertDays(body.withdrawalAlertDays);
        setWithdrawalAccountId(body.withdrawalAccountId ?? NO_ACCOUNT);
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
        label="引き落とし警告の日数（日）"
        htmlFor="withdrawal-alert-days"
        description="クレカの引き落とし日までこの日数以内で、予定額が引き落とし口座の残高を超える場合に警告します。1〜30、既定は 7。"
      >
        <div className="flex items-center gap-2">
          <Input
            id="withdrawal-alert-days"
            type="number"
            min={1}
            max={30}
            value={withdrawalAlertDays}
            onChange={(e) => setWithdrawalAlertDays(Number(e.target.value))}
            className="w-24"
            disabled={saving}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={saving || !Number.isFinite(withdrawalAlertDays) || withdrawalAlertDays < 1 || withdrawalAlertDays > 30}
            onClick={() => save({ withdrawalAlertDays }, "引き落とし警告の日数を保存しました")}
          >
            日数を保存
          </Button>
        </div>
      </FormField>

      <FormField
        label="引き落とし口座"
        htmlFor="withdrawal-account-id"
        description="クレカの引き落とし予定額と残高を比べる銀行口座。未設定の場合、銀行口座が1つだけなら自動でそれを使い、複数なら警告しません。"
      >
        <div className="flex items-center gap-2">
          <Select
            id="withdrawal-account-id"
            aria-label="引き落とし口座"
            className="w-72"
            value={withdrawalAccountId}
            disabled={saving}
            onChange={setWithdrawalAccountId}
            options={[
              { value: NO_ACCOUNT, label: "未設定（自動判定）" },
              ...withdrawalAccounts.map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() =>
              save(
                { withdrawalAccountId: withdrawalAccountId === NO_ACCOUNT ? null : withdrawalAccountId },
                "引き落とし口座を保存しました",
              )
            }
          >
            口座を保存
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
