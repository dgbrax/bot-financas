'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Logo } from '@/components/logo'

// Better Auth error codes -> pt-BR messages.
const AUTH_ERRORS: Record<string, string> = {
  USER_ALREADY_EXISTS: 'Já existe uma conta com esse e-mail. Tente entrar.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    'Já existe uma conta com esse e-mail. Tente entrar.',
  INVALID_EMAIL_OR_PASSWORD: 'E-mail ou senha incorretos.',
  INVALID_EMAIL: 'E-mail inválido.',
  INVALID_PASSWORD: 'Senha inválida.',
  PASSWORD_TOO_SHORT: 'A senha precisa ter pelo menos 8 caracteres.',
  PASSWORD_TOO_LONG: 'A senha é longa demais (máximo 128 caracteres).',
}

function authErrorMessage(
  error: { code?: string; status?: number },
  isSignUp: boolean,
) {
  if (error.status === 429) {
    return 'Muitas tentativas. Aguarde um pouco e tente de novo.'
  }
  if (error.code && AUTH_ERRORS[error.code]) return AUTH_ERRORS[error.code]
  return isSignUp
    ? 'Não foi possível criar a conta. Tente novamente.'
    : 'Não foi possível entrar. Tente novamente.'
}

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const isSignUp = mode === 'sign-up'

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const form = new FormData(e.currentTarget)
    const email = String(form.get('email'))
    const password = String(form.get('password'))

    let result: { error: { code?: string; status?: number } | null }
    try {
      result = isSignUp
        ? await authClient.signUp.email({
            email,
            password,
            name: String(form.get('name')).trim(),
          })
        : await authClient.signIn.email({ email, password })
    } catch {
      setLoading(false)
      setError('Sem conexão com o servidor. Tente novamente.')
      return
    }

    if (result.error) {
      setLoading(false)
      setError(authErrorMessage(result.error, isSignUp))
      return
    }
    router.push('/')
    router.refresh()
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <Logo />
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {isSignUp ? 'Criar conta' : 'Entrar'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isSignUp
              ? 'Comece a acompanhar cada real que entra e sai.'
              : 'Acesse seu extrato e suas estatísticas.'}
          </p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {isSignUp && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Nome</Label>
              <Input id="name" name="name" required autoComplete="name" />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading} className="h-10">
            {loading ? 'Aguarde...' : isSignUp ? 'Criar conta' : 'Entrar'}
          </Button>
        </form>

        <p className="text-sm text-muted-foreground">
          {isSignUp ? 'Já tem conta? ' : 'Ainda não tem conta? '}
          <Link
            href={isSignUp ? '/sign-in' : '/sign-up'}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {isSignUp ? 'Entrar' : 'Criar conta'}
          </Link>
        </p>
      </div>
    </main>
  )
}
