import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const viewSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/Contacts/ContactsView.tsx'), 'utf8')
const cssSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/Contacts/Contacts.css'), 'utf8')

describe('contacts layout', () => {
  it('derives pinyin initials locally without a pinyin dependency', () => {
    expect(viewSource).toContain('PINYIN_BOUNDARIES')
    expect(viewSource).toContain("new Intl.Collator('zh-Hans-CN-u-co-pinyin'")
    expect(viewSource).toMatch(/function initialOf\(name: string\): string/)
  })

  it('groups custom characters into letter sections with # sorted last', () => {
    expect(viewSource).toContain('data-contacts-section')
    expect(viewSource).toMatch(/a\.letter === '#' \? 1 : b\.letter === '#' \? -1/)
    expect(viewSource).toContain('contacts-letter')
  })

  it('renders the A-Z index rail with jump and bubble feedback', () => {
    expect(viewSource).toContain('data-contacts-index')
    expect(viewSource).toContain('jumpToLetter')
    expect(viewSource).toContain('contacts-bubble')
  })

  it('honors reduced motion when jumping to a letter', () => {
    expect(viewSource).toContain('(prefers-reduced-motion: reduce)')
  })

  it('keeps every contacts-smoke hook wired', () => {
    const hooks = [
      'data-contacts-root', 'data-contacts-search', 'data-contacts-new', 'data-contacts-item',
      'data-contacts-edit', 'data-contacts-delete', 'data-contacts-confirm-delete', 'data-contacts-form',
      'data-contacts-name', 'data-contacts-avatar', 'data-contacts-profile', 'data-contacts-model',
      'data-contacts-soulmd', 'data-contacts-save', 'data-contacts-fetch-models'
    ]
    for (const hook of hooks) expect(viewSource).toContain(hook)
  })

  it('styles the list with theme tokens on the WeChat gray-page scheme', () => {
    expect(cssSource).toContain('var(--bg-secondary)')
    expect(cssSource).toContain('var(--bg-primary)')
    expect(cssSource).toContain('var(--accent)')
    expect(cssSource).toMatch(/\.contacts-letter \{ position: sticky/)
    expect(cssSource).toMatch(/\.contacts-row-actions \{[^}]*opacity: 0/)
    expect(cssSource).toContain('.contacts-row:hover .contacts-row-actions')
  })

  it('disables transitions under reduced motion', () => {
    expect(cssSource).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
