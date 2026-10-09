"use client";

import { Slider as BaseSlider } from "@base-ui/react/slider";
import { cn } from "../../lib/cn";

interface SliderProps {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  ticks?: (number | { value: number; label: string })[];
}

function Slider({
  value,
  defaultValue,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  className,
  "aria-label": ariaLabel,
  ticks,
}: SliderProps) {
  return (
    <BaseSlider.Root
      value={value}
      defaultValue={defaultValue ?? min}
      onValueChange={onValueChange}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={cn("touch-none", className)}
    >
      <BaseSlider.Control className="flex w-full items-center py-2 select-none">
        <BaseSlider.Track
          className={cn("h-1.5 w-full rounded-full bg-muted", disabled && "opacity-50")}
        >
          <BaseSlider.Indicator className="rounded-full bg-primary" />
          <BaseSlider.Thumb
            aria-label={ariaLabel}
            className={cn(
              "size-4 rounded-full border-2 border-primary bg-background shadow-sm select-none",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "disabled:cursor-not-allowed",
            )}
          />
        </BaseSlider.Track>
      </BaseSlider.Control>
      {ticks && (
        <div className="flex w-full justify-between">
          {ticks.map((tick, i) => {
            const tickLabel = typeof tick === "number" ? `${tick}` : tick.label;
            return (
              <span key={i} className="text-xs text-muted-foreground">
                {tickLabel}
              </span>
            );
          })}
        </div>
      )}
    </BaseSlider.Root>
  );
}

export { Slider };
