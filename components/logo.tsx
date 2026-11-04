import { cn } from '@/lib/utils'

export function Logo({ textClassName }: { textClassName?: string } = {}) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="flex size-7 items-center justify-center rounded-md bg-primary font-mono text-sm font-semibold text-primary-foreground"
      >
        R$
      </span>
      <span
        className={cn(
          'text-base font-semibold tracking-tight whitespace-nowrap',
          textClassName,
        )}
      >
        Bot Finanças
      </span>
    </div>
  )
}
