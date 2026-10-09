import { ExternalLink as ExternalLinkIcon } from "lucide-react";
import type { AnchorHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

interface ExternalLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  text?: string;
  showIcon?: boolean;
}

function ExternalLink({ className, children, text, showIcon = true, ...props }: ExternalLinkProps) {
  return (
    <a
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex items-center gap-1 hover:opacity-70", className)}
      {...props}
    >
      {text && <span>{text}</span>}
      {children}
      {showIcon && <ExternalLinkIcon className="h-3.5 w-3.5" />}
    </a>
  );
}

export { ExternalLink };
