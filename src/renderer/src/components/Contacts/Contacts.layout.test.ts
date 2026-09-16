import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const viewSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/Contacts/ContactsView.tsx'), 'utf8')
const cssSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/Contacts/Contacts.css'), 'utf8')

describe('contacts layout', () => {
  it('sorts cards by pinyin locally without a pinyin dependency', () => {
    expect(viewSource).toContain("new Intl.Collator('zh-Hans-CN-u-co-pinyin'")
    expect(viewSource).toMatch(/function sortByName/)
  })

  it('lays filter options flat as toggle chips', () => {
    expect(viewSource).toContain('data-contacts-filter-category')
    expect(viewSource).toContain('data-contacts-filter-model')
    expect(viewSource).toContain('aria-pressed={category === option.value}')
    expect(cssSource).toMatch(/\.contacts-chip\[aria-pressed="true"\]/)
    expect(cssSource).toMatch(/\.contacts-filter-options \{[^}]*flex-wrap: wrap/)
  })

  it('renders contacts as a multi-per-row card grid', () => {
    expect(viewSource).toContain('contacts-grid')
    expect(cssSource).toMatch(/\.contacts-grid \{[^}]*display: grid/)
    expect(cssSource).toMatch(/repeat\(auto-fill, minmax\(/)
    expect(viewSource).toMatch(/className="contacts-card"/)
    expect(cssSource).toMatch(/\.contacts-card \{[^}]*border: 1px solid var\(--border\)/)
    expect(cssSource).toContain('.contacts-card:hover')
  })

  it('offers the new-character action as a dashed card in the grid', () => {
    expect(viewSource).toContain('contacts-new-card')
    expect(cssSource).toMatch(/\.contacts-new-card \{[^}]*border: 1px dashed/)
  })

  it('opens a detail panel on card click with chat, edit and delete actions', () => {
    expect(viewSource).toContain('data-contacts-detail=')
    expect(viewSource).toContain('data-contacts-start-chat=')
    expect(viewSource).toMatch(/data-contacts-edit=\{detail\.id\}/)
    expect(viewSource).toMatch(/data-contacts-delete=\{detail\.id\}/)
    expect(viewSource).toContain('contacts-detail-actions')
    expect(cssSource).toMatch(/\.contacts-detail \{/)
  })

  it('drops the letter sections, index rail and bubble from the list layout', () => {
    expect(viewSource).not.toContain('data-contacts-section')
    expect(viewSource).not.toContain('jumpToLetter')
    expect(viewSource).not.toContain('contacts-bubble')
    expect(viewSource).not.toContain('contacts-letter')
    expect(cssSource).not.toContain('.contacts-index')
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

  it('disables transitions under reduced motion', () => {
    expect(cssSource).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
