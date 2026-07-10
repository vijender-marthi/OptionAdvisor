export type WorkspaceTone = 'neutral' | 'info' | 'positive' | 'warning' | 'danger' | 'managing' | string

export function workspaceToneBadgeClass(tone: WorkspaceTone): string {
  switch (tone) {
    case 'positive':
      return 'border-semantic-bullish-border bg-semantic-bullish-bg text-semantic-bullish'
    case 'warning':
      return 'border-semantic-warning-border bg-semantic-warning-bg text-semantic-warning'
    case 'danger':
      return 'border-semantic-bearish-border bg-semantic-bearish-bg text-semantic-bearish'
    case 'managing':
      return 'border-semantic-manage-border bg-semantic-manage-bg text-semantic-manage'
    case 'info':
      return 'border-semantic-info-border bg-semantic-info-bg text-semantic-info'
    default:
      return 'border-semantic-neutral-border bg-semantic-neutral-bg text-semantic-neutral'
  }
}

export function workspaceToneTextClass(tone: WorkspaceTone): string {
  switch (tone) {
    case 'positive':
      return 'text-semantic-bullish'
    case 'warning':
      return 'text-semantic-warning'
    case 'danger':
      return 'text-semantic-bearish'
    case 'managing':
      return 'text-semantic-manage'
    case 'info':
      return 'text-semantic-info'
    default:
      return 'text-secondary'
  }
}
