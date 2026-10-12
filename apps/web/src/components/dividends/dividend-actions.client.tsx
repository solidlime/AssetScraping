"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "../ui/button";
import { FormField } from "../ui/form-field";
import { Input } from "../ui/input";
import { Select } from "../ui/select";

interface SyncResult {
  symbols?: number;
  events?: number;
  fx?: number | null;
  errors?: string[];
  error?: string;
}

/** 「配当を再取得」ボタン。結果（symbols/events/fx/errors）を必ず表示する。 */
export function DividendSyncButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);

  async function handleClick() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/dividends/sync", { method: "POST" });
      const body = (await res.json()) as SyncResult;
      setResult(body);
      if (res.ok && !body.error) {
        startTransition(() => router.refresh());
      }
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  }

  const busy = running || pending;

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={handleClick} disabled={busy}>
        <RefreshCw className={busy ? "animate-spin" : undefined} />
        {busy ? "再取得中…" : "配当を再取得"}
      </Button>
      {result && <SyncResultMessage result={result} />}
    </div>
  );
}

function SyncResultMessage({ result }: { result: SyncResult }) {
  if (result.error) {
    return <p className="text-sm text-destructive">再取得に失敗: {result.error}</p>;
  }
  return (
    <div className="text-sm text-muted-foreground">
      <p>
        取得: シンボル {result.symbols ?? 0} 件 / 配当イベント {result.events ?? 0} 件 / 為替{" "}
        {result.fx != null ? `${result.fx.toFixed(2)} 円` : "取得できず"}
      </p>
      {result.errors && result.errors.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-destructive">
          {result.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface UnresolvedItem {
  holdingName: string;
  rawHoldingName: string;
  category: string | null;
  reason: string;
}

/** 未解決銘柄の手動マッピングフォーム群。「対象外カテゴリ」は呼び出し側で除外済み。 */
export function DividendUnresolvedList({ items }: { items: UnresolvedItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        未解決の銘柄はありません。Yahoo シンボルが自動解決されるか、手動マッピング設定済みです。
      </p>
    );
  }
  return (
    <div className="space-y-6">
      {items.map((item) => (
        <DividendMappingForm key={`${item.holdingName}:${item.reason}`} item={item} />
      ))}
    </div>
  );
}

function DividendMappingForm({ item }: { item: UnresolvedItem }) {
  const router = useRouter();
  const [yahooSymbol, setYahooSymbol] = useState("");
  const [currency, setCurrency] = useState("__none__");
  const [annualDistributionPerUnit, setAnnualDistributionPerUnit] = useState("");
  const [paysDistribution, setPaysDistribution] = useState(true);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const perUnit = annualDistributionPerUnit.trim();
    const payload = {
      holdingName: item.rawHoldingName,
      yahooSymbol: yahooSymbol.trim() === "" ? null : yahooSymbol.trim(),
      currency: currency === "__none__" ? null : currency,
      annualDistributionPerUnit: perUnit === "" ? null : Number(perUnit),
      paysDistribution,
      note: note.trim() === "" ? null : note.trim(),
    };
    try {
      const res = await fetch("/api/dividends/mapping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (body.ok) {
        setMessage({ kind: "ok", text: "保存しました" });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: `保存失敗: ${body.error ?? res.statusText}` });
      }
    } catch (err) {
      setMessage({
        kind: "error",
        text: `保存失敗: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-[var(--color-balance-negative)]" />
        <span className="font-medium">{item.holdingName}</span>
        <span className="text-xs text-muted-foreground">{item.reason}</span>
      </div>

      {message && (
        <p
          className={
            message.kind === "ok" ? "text-sm text-[var(--color-balance-positive)]" : "text-sm text-destructive"
          }
        >
          {message.text}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="銘柄名（ssnb 生名）"
          htmlFor={`holdingName-${item.holdingName}`}
          description="マッピングのキー。変更できません。"
        >
          <Input id={`holdingName-${item.holdingName}`} value={item.rawHoldingName} readOnly />
        </FormField>

        <FormField
          label="Yahoo シンボル"
          htmlFor={`yahooSymbol-${item.holdingName}`}
          description="ETF・個別株は例: JEPQ / 9432.T。投信は空欄で可。"
        >
          <Input
            id={`yahooSymbol-${item.holdingName}`}
            value={yahooSymbol}
            onChange={(e) => setYahooSymbol(e.target.value)}
            placeholder="JEPQ"
            disabled={saving}
          />
        </FormField>

        <FormField label="通貨" htmlFor={`currency-${item.holdingName}`}>
          <Select
            id={`currency-${item.holdingName}`}
            value={currency}
            onChange={setCurrency}
            options={[
              { value: "__none__", label: "未指定（自動判定）" },
              { value: "USD", label: "USD" },
              { value: "JPY", label: "JPY" },
            ]}
          />
        </FormField>

        <FormField
          label="年間分配金（円 / 1万口あたり）"
          htmlFor={`annualDistributionPerUnit-${item.holdingName}`}
          description="投信・ラップ向け。入力すると Yahoo を使わず毎月均等に按分します。"
        >
          <Input
            id={`annualDistributionPerUnit-${item.holdingName}`}
            type="number"
            min={0}
            step={1}
            value={annualDistributionPerUnit}
            onChange={(e) => setAnnualDistributionPerUnit(e.target.value)}
            placeholder="例: 1200"
            disabled={saving}
          />
        </FormField>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!paysDistribution}
            onChange={(e) => setPaysDistribution(!e.target.checked)}
            disabled={saving}
          />
          無配（分配なし）として扱う
        </label>

        <div className="flex items-center gap-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="メモ（任意）"
            className="w-60"
            disabled={saving}
          />
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </form>
  );
}
