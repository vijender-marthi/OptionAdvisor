import type { ReactNode } from 'react'

export function display(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? 'Unavailable' : String(value)
}

export function price(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'Unavailable'
  return typeof value === 'number' ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : String(value)
}

export function percent(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'Unavailable'
  return typeof value === 'number' ? `${value}%` : String(value)
}

export function LabelValue({ label, value, mono = false }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-wider text-secondary">{label}</div>
      <div className={`mt-1 truncate text-sm font-semibold text-primary ${mono ? 'font-mono tabular-nums' : ''}`}>{display(value)}</div>
    </div>
  )
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-b border-slate-200 py-4 last:border-b-0 dark:border-white/[0.07]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-secondary">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function AvailabilityBadge({ value }: { value: string | null | undefined }) {
  return (
    <span className="rounded-full border border-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-secondary dark:border-white/[0.1]">
      {display(value)}
    </span>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 dark:bg-white/[0.08] ${className}`} />
}
