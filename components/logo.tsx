export function Logo() {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="flex size-7 items-center justify-center rounded-md bg-primary font-mono text-sm font-semibold text-primary-foreground"
      >
        R$
      </span>
      <span className="text-base font-semibold tracking-tight">
        Bot Finanças
      </span>
    </div>
  )
}
