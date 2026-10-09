import type { ComponentProps, Ref } from "react";
import { cn } from "../../lib/cn";

interface InputProps extends ComponentProps<"input"> {
  ref?: Ref<HTMLInputElement>;
}

function Input({ className, type, ref, ...props }: InputProps) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
}

export { Input };
