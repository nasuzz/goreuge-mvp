import type { ReactNode } from "react";
import type { BalanceLevel } from "@/shared/enums";

export function Card({
  title,
  aside,
  children,
  className = "",
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}
    >
      {(title || aside) && (
        <header className="mb-3 flex items-baseline justify-between gap-3">
          {title && <h2 className="text-sm font-semibold tracking-tight">{title}</h2>}
          {aside && <div className="text-xs text-muted">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageTitle({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-5">
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
    </header>
  );
}

const TONE = {
  safe: "bg-safe-bg text-safe",
  caution: "bg-caution-bg text-caution",
  danger: "bg-danger-bg text-danger",
  neutral: "bg-surface-muted text-muted",
} as const;

export type Tone = keyof typeof TONE;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

/** 엔진의 BalanceLevel을 화면 톤으로 옮긴다. 색 판단은 엔진이 하고 화면은 옮기기만 한다. */
export function toneOfLevel(level: BalanceLevel): Tone {
  return level;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-5 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-sm text-muted">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Row({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: string;
  tone?: "plus" | "minus";
  note?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-sm text-muted">
        {label}
        {note && <span className="ml-1 text-xs opacity-70">{note}</span>}
      </span>
      <span
        className={`tnum text-sm font-medium ${
          tone === "minus" ? "text-danger" : tone === "plus" ? "text-safe" : ""
        }`}
      >
        {tone === "minus" ? "−" : tone === "plus" ? "+" : ""}
        {value}
      </span>
    </div>
  );
}
