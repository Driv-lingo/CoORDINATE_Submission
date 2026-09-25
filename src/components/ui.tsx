import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-dark disabled:bg-slate-400",
  secondary: "bg-white text-ink border border-line hover:bg-slate-50 disabled:text-slate-400",
  ghost: "text-brand hover:bg-brand-soft disabled:text-slate-400",
  danger: "bg-life text-white hover:bg-red-800 disabled:bg-slate-400",
  success: "bg-done text-white hover:bg-green-800 disabled:bg-slate-400",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  busy,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; busy?: boolean }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors disabled:cursor-not-allowed",
        size === "sm" ? "px-2.5 py-1.5 text-sm" : size === "lg" ? "px-5 py-3 text-base" : "px-3.5 py-2 text-sm",
        VARIANTS[variant],
        className,
      )}
      disabled={busy || rest.disabled}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Card({ children, className, as: As = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div" | "article"; "aria-labelledby"?: string }) {
  return (
    <As className={cn("min-w-0 rounded-lg border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]", className)} {...rest}>
      {children}
    </As>
  );
}

export function CardHeader({ title, icon, right, subtitle, id }: { title: ReactNode; icon?: ReactNode; right?: ReactNode; subtitle?: ReactNode; id?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 id={id} className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          {icon}
          {title}
        </h2>
        {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export function Pill({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold", className)}>
      {children}
    </span>
  );
}

export function Stat({ label, value, hint, tone = "ink" }: { label: string; value: ReactNode; hint?: string; tone?: "ink" | "life" | "done" | "active" | "brand" }) {
  const toneCls = { ink: "text-ink", life: "text-life", done: "text-done", active: "text-active", brand: "text-brand" }[tone];
  return (
    <div className="min-w-0">
      <div className={cn("text-2xl font-bold tabular-nums leading-tight", toneCls)}>{value}</div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      {hint ? <div className="text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

export function Callout({ tone = "info", title, children, icon }: { tone?: "info" | "warn" | "danger" | "success"; title?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  const cls = {
    info: "border-brand/30 bg-brand-soft text-ink",
    warn: "border-trained/40 bg-trained-soft text-ink",
    danger: "border-life/40 bg-life-soft text-ink",
    success: "border-done/40 bg-done-soft text-ink",
  }[tone];
  return (
    <div className={cn("flex gap-3 rounded-md border px-3 py-2.5 text-sm", cls)} role={tone === "danger" ? "alert" : undefined}>
      {icon ? <div className="mt-0.5 shrink-0">{icon}</div> : null}
      <div className="min-w-0">
        {title ? <div className="font-semibold">{title}</div> : null}
        {children ? <div className={title ? "mt-0.5" : undefined}>{children}</div> : null}
      </div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-ink">{children}</kbd>;
}
