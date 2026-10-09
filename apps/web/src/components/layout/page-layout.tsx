import { ExternalLink as ExternalLinkIcon } from "lucide-react";
import { ExternalLink } from "../ui/external-link";

interface PageLayoutProps {
  title: string;
  href?: string;
  options?: React.ReactNode;
  children: React.ReactNode;
}

export function PageLayout({ title, href, options, children }: PageLayoutProps) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-foreground inline-flex items-center gap-2">
            {title}
            {href && (
              <ExternalLink
                href={href}
                showIcon={false}
                aria-label={`${title} を Money Forward で開く`}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <ExternalLinkIcon className="h-4 w-4" />
              </ExternalLink>
            )}
          </h1>
          {options && <div className="flex items-center gap-3 self-end sm:self-auto">{options}</div>}
        </div>
        {children}
      </div>
    </main>
  );
}
