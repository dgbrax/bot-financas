'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/logo'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/', label: 'Painel' },
  { href: '/contas', label: 'Contas' },
  { href: '/conexoes', label: 'Conexões' },
] as const

export function DashboardHeader({ name }: { name: string }) {
  const router = useRouter()
  const pathname = usePathname()

  async function signOut() {
    await authClient.signOut()
    router.push('/sign-in')
    router.refresh()
  }

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-5 md:px-8">
        <div className="flex items-center gap-4 sm:gap-6">
          <Link href="/" aria-label="Bot Finanças, início">
            <Logo textClassName="hidden sm:inline" />
          </Link>
          <nav aria-label="Principal" className="flex items-center gap-1 text-sm">
            {NAV.map((item) => {
              const active = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'rounded-md px-2.5 py-1 font-medium text-muted-foreground transition-colors hover:text-foreground',
                    active && 'bg-muted text-foreground',
                  )}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {name}
          </span>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="size-4" aria-hidden="true" />
            Sair
          </Button>
        </div>
      </div>
    </header>
  )
}
