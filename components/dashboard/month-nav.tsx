import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatMonthLabel, shiftMonth } from '@/lib/finance'
import { buttonVariants } from '@/components/ui/button'

export function MonthNav({ month }: { month: string }) {
  return (
    <nav aria-label="Selecionar mês" className="flex items-center gap-1">
      <Link
        href={`/?mes=${shiftMonth(month, -1)}`}
        aria-label="Mês anterior"
        className={buttonVariants({ variant: 'ghost', size: 'icon' })}
      >
        <ChevronLeft className="size-4" />
      </Link>
      <span className="min-w-36 text-center text-sm font-medium">
        {formatMonthLabel(month)}
      </span>
      <Link
        href={`/?mes=${shiftMonth(month, 1)}`}
        aria-label="Próximo mês"
        className={buttonVariants({ variant: 'ghost', size: 'icon' })}
      >
        <ChevronRight className="size-4" />
      </Link>
    </nav>
  )
}
