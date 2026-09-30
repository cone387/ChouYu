import { expect, it } from 'vitest'
import { contactTaskHref, parseContactTaskHref } from './contact-links'
it('round trips real task IDs and rejects unrelated or incomplete URLs', () => {
  expect(parseContactTaskHref(contactTaskHref('a&b', '中文:42'))).toEqual({ characterId: 'a&b', topicId: '中文:42' })
  expect(parseContactTaskHref('https://example.com/#contact-task?characterId=a&topicId=b')).toBeUndefined()
  expect(parseContactTaskHref('#contact-task?characterId=a')).toBeUndefined()
  expect(parseContactTaskHref('#contact-task?characterId=a&topicId=' + 'x'.repeat(129))).toBeUndefined()
})
