import type { QuickAction } from '../../types'

interface QuickActionsProps {
  disabled: boolean
  language: string
  onAction: (action: QuickAction) => void
}

function Icon({ action }: { action: QuickAction }) {
  const common = {
    'aria-hidden': true,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'h-3.5 w-3.5',
  }

  switch (action) {
    case 'summarize':
      return (
        <svg {...common}>
          <path d="M4 3.5h12M4 7h12M4 10.5h8M4 14h10M4 17h6" />
        </svg>
      )
    case 'key-points':
      return (
        <svg {...common}>
          <path d="M7 5h9M7 10h9M7 15h9" />
          <circle cx="4" cy="5" r="1" fill="currentColor" stroke="none" />
          <circle cx="4" cy="10" r="1" fill="currentColor" stroke="none" />
          <circle cx="4" cy="15" r="1" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'eli5':
      return (
        <svg {...common}>
          <path d="M10 2.75a5.25 5.25 0 0 0-3 9.56c.5.35.75.85.75 1.44v.5h4.5v-.5c0-.59.25-1.09.75-1.44a5.25 5.25 0 0 0-3-9.56Z" />
          <path d="M8.25 16.75h3.5M8.75 18.5h2.5" />
        </svg>
      )
    case 'translate':
      return (
        <svg {...common}>
          <path d="M2.5 4.5h8M6.5 3v1.5M8.5 4.5c-.4 2.4-1.7 4.4-3.9 5.7M4.6 7.4c.7 1.8 2 3 3.9 3.6M11.5 17l3-8 3 8M12.6 14h3.8" />
        </svg>
      )
  }
}

const ACTIONS: ReadonlyArray<{ action: QuickAction; label: string; title: string }> = [
  { action: 'summarize', label: 'Summarize', title: 'Summarize this page' },
  { action: 'key-points', label: 'Key points', title: 'List the key points' },
  { action: 'eli5', label: 'ELI5', title: 'Explain this page simply' },
  { action: 'translate', label: 'Translate', title: 'Translate this page' },
]

export default function QuickActions({ disabled, language, onAction }: QuickActionsProps) {
  return (
    <div
      className="grid grid-cols-2 gap-1.5"
      role="group"
      aria-label="Quick actions for the current page"
    >
      {ACTIONS.map(({ action, label, title }) => {
        const fullTitle = action === 'translate' ? `${title} to ${language}` : title
        return (
          <button
            key={action}
            type="button"
            disabled={disabled}
            onClick={() => onAction(action)}
            title={fullTitle}
            aria-label={fullTitle}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-brand-700 dark:hover:bg-brand-950/40 dark:hover:text-brand-200"
          >
            <Icon action={action} />
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}
