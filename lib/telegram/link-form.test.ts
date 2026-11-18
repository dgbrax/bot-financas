import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const ui = vi.hoisted(() => ({ states: [] as unknown[], pending: false }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useActionState: () => [ui.states.shift() ?? {}, () => {}, ui.pending],
}))
vi.mock('@/app/actions/telegram', () => ({ createTelegramLink: vi.fn(), revokeTelegramLink: vi.fn() }))
import { TelegramLinkForm } from '@/components/telegram/link-form'

beforeEach(() => { ui.states = []; ui.pending = false })
function render(linked = false) {
  return renderToStaticMarkup(createElement(TelegramLinkForm, { accounts: [{ id: 1, name: 'Carteira' }], linked }))
}
describe('Telegram link form', () => {
  it('submits both forms with the real Base UI button instead of its type=button default', () => {
    const html = render()
    expect(html.match(/<button\b[^>]*type="submit"/g)).toHaveLength(2)
    expect(html).toContain('Gerar link de uso único')
  })
  it('renders the returned link as readonly, with separate copy/open controls and success feedback', () => {
    ui.states = [{ url: 'https://t.me/botfinancas_dgbrax_bot?start=synthetic-test-only', expiresAt: new Date(Date.now() + 600000).toISOString() }, {}]
    const html = render()
    expect(html).toMatch(/<input[^>]*id="telegram-link"[^>]*readOnly=""/)
    expect(html).toContain('Copiar link')
    expect(html).toMatch(/<button\b[^>]*type="button"/)
    expect(html).toContain('Abrir no Telegram')
    expect(html).toContain('referrerPolicy="no-referrer"')
    expect(html).toContain('Link gerado.')
  })
  it('shows server errors without displaying an old or invented success link', () => {
    ui.states = [{ error: 'Conta não encontrada.' }, {}]
    const html = render()
    expect(html).toContain('role="alert"')
    expect(html).toContain('Conta não encontrada.')
    expect(html).not.toContain('id="telegram-link"')
    expect(html).not.toContain('Link gerado.')
  })
  it('hides a previous result while another request is pending', () => {
    ui.pending = true
    ui.states = [{ url: 'https://example.test/old-link' }, {}]
    const html = render()
    expect(html).toContain('Gerando…')
    expect(html).not.toContain('id="telegram-link"')
  })
  it('does not offer a new link when the account is already linked', () => {
    const html = render(true)
    expect(html).not.toContain('Gerar link de uso único')
    expect(html).toContain('Revogar vínculo e links pendentes')
  })
})
