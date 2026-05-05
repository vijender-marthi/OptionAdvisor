/** Shown next to the product name while the app is in beta.
 *  Light theme: sidebar/login chrome uses pale surfaces — use solid amber chip (readable).
 *  Dark theme: translucent amber on dark chrome (`dark:` ↔ html.dark from Tailwind config).
 */
export default function BetaProductTag({ className = '' }: { className?: string }) {
  return (
    <span
      className={`product-beta-tag inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide
        border-amber-700/45 bg-amber-100 text-amber-950
        dark:border-amber-400/45 dark:bg-amber-400/15 dark:text-amber-100
        ${className}`.trim()}
      title="Beta — features and data may change"
    >
      Beta
    </span>
  )
}
