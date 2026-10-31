"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/button";
import { FormField } from "../ui/form-field";
import { Input } from "../ui/input";
import { Select } from "../ui/select";

/** crawler の ScheduledPayment と同形（web は表示にしか使わない） */
interface FixedCost {
  id: string;
  name: string;
  amount: number;
  withdrawalDay: number;
  withdrawalAccountId: string;
  isActive: boolean;
}

interface FixedCostsPayload {
  ok: boolean;
  payments?: FixedCost[];
  error?: string;
}

const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => ({
  value: String(i + 1),
  label: `毎月${i + 1}日`,
}));

/**
 * 固定費（家賃・電気代など口座から落ちる定額）の設定。crawler の /fixed-costs を /api/fixed-costs 経由で CRUD する。
 * 楽観更新はしない（各操作後に一覧を取り直す）。
 */
export function FixedCostsSection({ withdrawalAccounts }: { withdrawalAccounts: { id: string; name: string }[] }) {
  const [payments, setPayments] = useState<FixedCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // 追加フォーム（金額は空欄を許すため文字列で持つ）
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [withdrawalDay, setWithdrawalDay] = useState("1");
  const [withdrawalAccountId, setWithdrawalAccountId] = useState(withdrawalAccounts[0]?.id ?? "");

  // インライン編集（1行ずつ保存）
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FixedCost | null>(null);

  const fetchPayments = useCallback(async () => {
    const res = await fetch("/api/fixed-costs");
    const body = (await res.json()) as FixedCostsPayload;
    if (!body.ok || !body.payments) throw new Error(body.error ?? res.statusText);
    setPayments(body.payments);
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        await fetchPayments();
      } catch (err) {
        setMessage({ kind: "error", text: `読み込み失敗: ${err instanceof Error ? err.message : String(err)}` });
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchPayments]);

  /** 1操作 = 1リクエスト + 一覧取り直し。成功したら true */
  async function request(method: "POST" | "PUT" | "DELETE", payload: Record<string, unknown>, successText: string) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/fixed-costs", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as FixedCostsPayload;
      if (!body.ok) {
        setMessage({ kind: "error", text: `保存失敗: ${body.error ?? res.statusText}` });
        return false;
      }
      await fetchPayments();
      setMessage({ kind: "ok", text: successText });
      return true;
    } catch (err) {
      setMessage({ kind: "error", text: `保存失敗: ${err instanceof Error ? err.message : String(err)}` });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function add() {
    const ok = await request(
      "POST",
      { name: name.trim(), amount: Number(amount), withdrawalDay: Number(withdrawalDay), withdrawalAccountId },
      "固定費を追加しました",
    );
    if (ok) {
      setName("");
      setAmount("");
    }
  }

  async function saveEdit() {
    if (!draft) return;
    if (await request("PUT", { ...draft }, "固定費を更新しました")) {
      setEditingId(null);
      setDraft(null);
    }
  }

  function accountName(id: string): string {
    return withdrawalAccounts.find((a) => a.id === id)?.name ?? "（不明な口座）";
  }

  const accountOptions = withdrawalAccounts.map((a) => ({ value: a.id, label: a.name }));
  const canAdd =
    !saving && name.trim() !== "" && Number(amount) > 0 && withdrawalAccountId !== "";

  if (loading) {
    return <p className="text-sm text-muted-foreground">読み込み中…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">口座引き落とし（固定費）</h2>
        <p className="text-sm text-muted-foreground">
          家賃・電気代など、口座から落ちる定額の支払いを登録します。引き落とし日が近づくと、カードの引き落としと合算して残高不足を警告します。
        </p>
      </div>

      {message && (
        <p className={message.kind === "ok" ? "text-sm text-green-600" : "text-sm text-destructive"}>
          {message.text}
        </p>
      )}

      {withdrawalAccounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          引き落としに使える銀行口座がないため登録できません。先に口座を連携してください。
        </p>
      ) : (
        <FormField label="固定費を追加" htmlFor="fixed-cost-name">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="fixed-cost-name"
              type="text"
              placeholder="家賃"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-48"
              disabled={saving}
            />
            <Input
              aria-label="金額（円）"
              type="number"
              min={1}
              placeholder="金額"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-32"
              disabled={saving}
            />
            <Select
              aria-label="引き落とし日"
              className="w-32"
              value={withdrawalDay}
              disabled={saving}
              onChange={setWithdrawalDay}
              options={DAY_OPTIONS}
            />
            <Select
              aria-label="引き落とし口座"
              className="w-56"
              value={withdrawalAccountId}
              disabled={saving}
              onChange={setWithdrawalAccountId}
              options={accountOptions}
            />
            <Button variant="outline" size="sm" disabled={!canAdd} onClick={() => void add()}>
              追加
            </Button>
          </div>
        </FormField>
      )}

      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          まだ登録されていません。家賃・電気代など、口座から落ちる定額の支払いを追加すると引き落とし前に残高不足を警告します。
        </p>
      ) : (
        <div className="space-y-2">
          {payments.map((payment) =>
            editingId === payment.id && draft ? (
              <div key={payment.id} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-2 py-1">
                <Input
                  aria-label="名称"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="w-48"
                  disabled={saving}
                />
                <Input
                  aria-label="金額（円）"
                  type="number"
                  min={1}
                  value={draft.amount}
                  onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })}
                  className="w-32"
                  disabled={saving}
                />
                <Select
                  aria-label="引き落とし日"
                  className="w-32"
                  value={String(draft.withdrawalDay)}
                  disabled={saving}
                  onChange={(value) => setDraft({ ...draft, withdrawalDay: Number(value) })}
                  options={DAY_OPTIONS}
                />
                <Select
                  aria-label="引き落とし口座"
                  className="w-56"
                  value={draft.withdrawalAccountId}
                  disabled={saving}
                  onChange={(value) => setDraft({ ...draft, withdrawalAccountId: value })}
                  options={accountOptions}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving || draft.name.trim() === "" || !(draft.amount > 0)}
                  onClick={() => void saveEdit()}
                >
                  保存
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setEditingId(null);
                    setDraft(null);
                  }}
                >
                  キャンセル
                </Button>
              </div>
            ) : (
              <div key={payment.id} className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-auto justify-start gap-3 px-2 ${payment.isActive ? "" : "opacity-50"}`}
                  disabled={saving}
                  onClick={() => {
                    setEditingId(payment.id);
                    setDraft(payment);
                  }}
                >
                  <span className="w-40 truncate text-left">{payment.name}</span>
                  <span className="w-24 text-right">{payment.amount.toLocaleString("ja-JP")}円</span>
                  <span className="w-20">毎月{payment.withdrawalDay}日</span>
                  <span className="w-40 truncate text-left text-muted-foreground">
                    {accountName(payment.withdrawalAccountId)}
                  </span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() =>
                    void request(
                      "PUT",
                      { ...payment, isActive: !payment.isActive },
                      payment.isActive ? "固定費を無効にしました" : "固定費を有効にしました",
                    )
                  }
                >
                  {payment.isActive ? "有効" : "無効"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    if (!window.confirm(`「${payment.name}」を削除しますか？`)) return;
                    void request("DELETE", { id: payment.id }, "固定費を削除しました");
                  }}
                >
                  削除
                </Button>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
