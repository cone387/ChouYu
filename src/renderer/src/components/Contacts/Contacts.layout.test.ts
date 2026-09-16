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

  it('turns industries into a label-free tab strip with model chips beside it', () => {
    expect(viewSource).toContain('data-contacts-filter-category')
    expect(viewSource).toContain('data-contacts-filter-model')
    expect(viewSource).not.toContain('contacts-filter-label')
    expect(viewSource).toContain('INDUSTRIES.filter((industry) => characters.some((character) => character.category === industry.id))')
    expect(viewSource).toContain('aria-pressed={category === industry.id}')
    expect(viewSource).toContain("onClick={() => setCategory('all')}>全部</button>")
    expect(viewSource).toContain("onClick={() => setCategory('other')}>其他</button>")
    expect(viewSource).toContain("(category === 'other' ? !character.category : character.category === category)")
    expect(viewSource).toContain('>全部模型</button>')
    expect(cssSource).toMatch(/\.contacts-tab-list \{/)
    expect(cssSource).toMatch(/\.contacts-tab\[aria-pressed="true"\]/)
    expect(cssSource).toMatch(/\.contacts-tab\[aria-pressed="true"\]::after/)
    expect(cssSource).toMatch(/\.contacts-tab-models \{[^}]*flex-wrap: wrap/)
    expect(cssSource).toMatch(/\.contacts-chip\[aria-pressed="true"\]/)
  })

  it('lets the industry follow the character across card tag, detail row and form select', () => {
    expect(viewSource).toContain('INDUSTRY_LABELS[character.category]')
    expect(viewSource).toContain('{detail.category ? INDUSTRY_LABELS[detail.category] :')
    expect(viewSource).toMatch(/data-contacts-category value=\{form\.category\}/)
    expect(viewSource).toContain('<option value="">未分类</option>')
    expect(viewSource).toContain('INDUSTRIES.map((industry) => <option key={industry.id}')
  })

  it('renders contacts as marketplace cards on a light gray grid', () => {
    expect(viewSource).toContain('contacts-grid')
    expect(cssSource).toMatch(/\.contacts-grid \{[^}]*display: grid/)
    expect(cssSource).toMatch(/repeat\(auto-fill, minmax\(/)
    expect(cssSource).toMatch(/\.contacts-scroll \{[^}]*background: var\(--bg-secondary\)/)
    expect(viewSource).toMatch(/className="contacts-card"/)
    expect(cssSource).toMatch(/\.contacts-card \{[^}]*background: var\(--bg-primary\)/)
    expect(cssSource).toContain('.contacts-card:hover')
  })

  it('structures each card as head row, clamped summary and tag row', () => {
    expect(viewSource).toContain('contacts-card-head')
    expect(viewSource).toContain('contacts-card-title')
    expect(viewSource).toContain('contacts-card-desc')
    expect(viewSource).toContain('contacts-card-tags')
    expect(cssSource).toMatch(/\.contacts-card-avatar \{[^}]*border-radius: 50%/)
    expect(cssSource).toMatch(/\.contacts-card-desc \{[^}]*-webkit-line-clamp: 2/)
    expect(cssSource).toMatch(/\.contacts-card-tag \{/)
    expect(cssSource).toMatch(/\.contacts-card-tags \{[^}]*margin-top: auto/)
  })

  it('offers a pinyin/popular/recent segmented sort next to the search', () => {
    expect(viewSource).toContain('data-contacts-sort')
    expect(viewSource).toContain("value: 'pinyin', label: '拼音'")
    expect(viewSource).toContain("value: 'popular', label: '最热'")
    expect(viewSource).toContain("value: 'recent', label: '最新'")
    expect(viewSource).toContain('aria-pressed={sort === option.value}')
    expect(cssSource).toMatch(/\.contacts-sort-option\[aria-pressed="true"\]/)
  })

  it('moves the new-character action into the search toolbar row as a quiet peer', () => {
    expect(viewSource).toMatch(/data-contacts-new className="contacts-new"/)
    expect(viewSource).not.toContain('contacts-new-card')
    expect(cssSource).toMatch(/\.contacts-new \{[^}]*background: color-mix\(in srgb, var\(--text-muted\) 10%/)
    expect(cssSource).toMatch(/\.contacts-new \{[^}]*height: 30px/)
    expect(cssSource).toMatch(/\.contacts-search-box \{[^}]*height: 30px/)
    expect(cssSource).toMatch(/\.contacts-toolbar \{[^}]*display: flex/)
  })

  it('resizes detail and form by dragging their borders instead of a corner handle', () => {
    expect(viewSource).toContain("(['n', 's', 'e', 'w'] as const)")
    expect(viewSource).toContain('contacts-resize-${edge}')
    expect(viewSource).toContain('onPointerDown={beginDrag(edge)}')
    expect(cssSource).toMatch(/\.contacts-resize-n \{[^}]*cursor: ns-resize/)
    expect(cssSource).toMatch(/\.contacts-resize-e \{[^}]*cursor: ew-resize/)
    expect(cssSource).not.toContain('resize: both')
    expect(cssSource).toMatch(/\.contacts-detail \{[^}]*position: absolute/)
    expect(cssSource).toMatch(/\.contacts-form \{[^}]*position: absolute/)
  })

  it('makes the avatar editable with a live preview and emoji quick picks', () => {
    expect(viewSource).toContain('contacts-avatar-preview')
    expect(viewSource).toContain('contacts-avatar-palette')
    expect(viewSource).toContain('contacts-avatar-option')
    expect(viewSource).toContain("aria-pressed={form.avatar === emoji}")
    expect(cssSource).toMatch(/\.contacts-avatar-preview \{[^}]*border-radius: 50%/)
    expect(cssSource).toMatch(/\.contacts-avatar-option\[aria-pressed="true"\]/)
  })

  it('keeps the detail panel compact so it fits without an outer scrollbar', () => {
    expect(cssSource).toMatch(/\.contacts-detail-soul \{[^}]*max-height: 120px/)
    expect(cssSource).toMatch(/\.contacts-field \{[^}]*min-height: 36px/)
    expect(cssSource).toMatch(/\.contacts-detail-actions button \{[^}]*min-height: 30px/)
  })

  it('closes detail, confirm and form dialogs on Escape before the panel swallows it', () => {
    expect(viewSource).toMatch(/event\.key !== 'Escape'/)
    expect(viewSource).toContain("window.addEventListener('keydown', closeOnEscape, true)")
    expect(viewSource).toMatch(/if \(form\) setForm\(null\)/)
    expect(viewSource).toMatch(/else if \(confirmDelete\) setConfirmDelete\(null\)/)
    expect(viewSource).toMatch(/else setDetail\(null\)/)
  })

  it('keeps the fetch-models action inline inside the model field row', () => {
    expect(viewSource).toContain('>获取模型</button>')
    expect(viewSource).toMatch(/data-contacts-model[^\n]*list="contacts-model-options"/)
    expect(cssSource).toMatch(/\.contacts-fetch \{[^}]*flex: none/)
    expect(cssSource).toMatch(/\.contacts-fetch \{[^}]*min-height: 26px/)
    expect(cssSource).toMatch(/\.contacts-hint \{[^}]*padding-left: 54px/)
  })

  it('opens a detail panel on card click with chat, edit and delete actions', () => {
    expect(viewSource).toContain("'data-contacts-detail': detail.id")
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

  it('opens the focused character detail when jumped from the chat info bar', () => {
    expect(viewSource).toContain('focusCharacterId?: string | null')
    expect(viewSource).toMatch(/if \(!active \|\| !focusCharacterId\) return/)
    expect(viewSource).toContain('onFocusConsumed?.()')
    expect(viewSource).toContain('setDetail(character)')
  })
})
