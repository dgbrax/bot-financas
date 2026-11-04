import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Logo } from '@/components/logo'

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Logo />
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Página não encontrada
          </h1>
          <p className="text-sm text-muted-foreground">
            O endereço que você abriu não existe.
          </p>
        </div>
        <Link href="/" className={buttonVariants({ className: 'w-fit' })}>
          Ir para o início
        </Link>
      </div>
    </main>
  )
}
