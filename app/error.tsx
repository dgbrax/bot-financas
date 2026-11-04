'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button, buttonVariants } from '@/components/ui/button'
import { Logo } from '@/components/logo'

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Logo />
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Algo deu errado
          </h1>
          <p className="text-sm text-muted-foreground">
            Não foi possível carregar esta página. Verifique sua conexão e tente
            de novo.
          </p>
          {error.digest && (
            <p className="font-mono text-xs text-muted-foreground">
              Código: {error.digest}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={reset}>Tentar de novo</Button>
          <Link href="/" className={buttonVariants({ variant: 'ghost' })}>
            Ir para o início
          </Link>
        </div>
      </div>
    </main>
  )
}
