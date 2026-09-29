import { expect, it } from 'vitest'
import { isLatestMessageVisible } from './useReminderRead'

function viewport(overrides: { focused?: boolean; hidden?: boolean; modal?: boolean; height?: number; bottom?: number } = {}) {
  const area = {
    ownerDocument: {
      hasFocus: () => overrides.focused ?? true,
      visibilityState: overrides.hidden ? 'hidden' : 'visible',
      querySelector: () => overrides.modal ? {} : null
    },
    clientHeight: overrides.height ?? 500,
    getBoundingClientRect: () => ({ top: 0, bottom: 500 })
  } as unknown as HTMLElement
  const last = { getBoundingClientRect: () => ({ top: (overrides.bottom ?? 500) - 1, bottom: overrides.bottom ?? 500 }) } as HTMLElement
  return { area, last }
}

it('recognizes the latest visible content in a focused conversation', () => {
  const { area, last } = viewport()
  expect(isLatestMessageVisible(area, last, true)).toBe(true)
})

it.each([
  { focused: false }, { hidden: true }, { modal: true }, { height: 0 }, { bottom: 600 }, { bottom: -10 }
])('keeps replies unread when the content is not being viewed: %j', options => {
  const { area, last } = viewport(options)
  expect(isLatestMessageVisible(area, last, true)).toBe(false)
})

it('does not acknowledge closed, inactive, searching or unmounted conversations', () => {
  const { area, last } = viewport()
  expect(isLatestMessageVisible(area, last, false)).toBe(false)
  expect(isLatestMessageVisible(null, last, true)).toBe(false)
  expect(isLatestMessageVisible(area, null, true)).toBe(false)
})
