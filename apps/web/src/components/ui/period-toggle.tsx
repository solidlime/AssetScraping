import { cn } from "../../lib/cn";

interface PeriodToggleOption<T extends string> {
  value: T;
  label: string;
}

interface PeriodToggleProps<T extends string> {
  options: PeriodToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function PeriodToggle<T extends string>({
  options,
  value,
  onChange,
  className,
}: PeriodToggleProps<T>) {
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "px-3 py-1 text-xs rounded-md transition-colors font-semibold cursor-pointer whitespace-nowrap",
            value === opt.value
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
