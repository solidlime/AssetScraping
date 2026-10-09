"use client";

import { ChevronDown, Check } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button } from "./button";

/**
 * 複数選択フィルタ（本家 multi-select-filter の簡素化版。popover を自前実装）。
 */
interface MultiSelectFilterProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  getLabel?: (option: string) => string;
}

export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  getLabel,
}: MultiSelectFilterProps) {
  const displayLabel = (option: string) => (getLabel ? getLabel(option) : option);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleToggle = (value: string) => {
    const newSelected = selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value];
    onChange(newSelected);
  };

  const buttonLabel = selected.length > 0 ? `${label} (${selected.length})` : label;

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="outline"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={buttonLabel}
        className="w-full justify-between sm:w-auto"
        onClick={() => setOpen((v) => !v)}
      >
        {buttonLabel}
        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
      {open && (
        <div
          className={cn(
            "absolute right-0 z-50 mt-1 w-[280px] rounded-md border bg-popover p-0 text-popover-foreground shadow-md",
          )}
        >
          <div className="max-h-[300px] overflow-y-auto overflow-x-hidden">
            <div className="flex gap-2 p-2 border-b">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChange(options)}
                className="flex-1 h-8 text-xs"
              >
                すべて選択
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChange([])}
                className="flex-1 h-8 text-xs"
              >
                すべて解除
              </Button>
            </div>
            <div className="p-1">
              {options.length === 0 && (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">選択肢がありません</p>
              )}
              {options.map((option) => {
                const checked = selected.includes(option);
                return (
                  <label
                    key={option}
                    className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleToggle(option)}
                      className="mr-2 h-4 w-4 shrink-0 rounded-sm border border-primary accent-[var(--color-primary)]"
                      aria-label={`${displayLabel(option)}を選択`}
                    />
                    <span className="flex items-center gap-1">
                      {displayLabel(option)}
                      {checked && <Check className="h-3 w-3 text-primary" />}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export type { ReactNode };
