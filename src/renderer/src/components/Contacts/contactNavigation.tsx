import { useState, type ReactNode } from 'react'
import { parseContactTaskHref } from '../../../../shared/contact-links'

export type ContactNavigation = { kind: 'settings' } | { kind: 'task'; characterId: string; topicId: string } | { kind: 'message'; sessionId: string; messageId: string }
export type ContactNavigationRequest = { target: ContactNavigation; handled: boolean; resolve: () => void; reject: (error: Error) => void }
export const CONTACT_NAVIGATION = 'chouyu:contact-navigation'
export function navigateContact(target: ContactNavigation): Promise<void> {
  return new Promise((resolve, reject) => {
    const detail: ContactNavigationRequest = { target, handled: false, resolve, reject }
    window.dispatchEvent(new CustomEvent(CONTACT_NAVIGATION, { detail }))
    if (!detail.handled) reject(new Error('暂时无法打开，请返回主窗口后重试。'))
  })
}
export function ContactLink({ href, children }: { href?: string; children: ReactNode }) {
  const [error, setError] = useState('')
  const target = parseContactTaskHref(href)
  return <><a href={href} target={target ? undefined : '_blank'} rel="noopener noreferrer" onClick={target ? event => {
    event.preventDefault(); setError('')
    void navigateContact({ kind: 'task', ...target }).catch(error => setError(error.message))
  } : undefined}>{children}</a>{error && <span role="alert">{error}</span>}</>
}
