export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Carregando"
      className="mx-auto flex w-full max-w-5xl animate-pulse flex-col gap-10 px-5 pt-20 pb-16 md:px-8"
    >
      <div className="flex flex-col gap-3">
        <div className="h-4 w-24 rounded bg-muted" />
        <div className="h-12 w-64 rounded bg-muted" />
        <div className="h-1.5 w-96 max-w-full rounded bg-muted" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-20 rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-32 rounded-xl bg-muted" />
      <span className="sr-only">Carregando…</span>
    </div>
  )
}
