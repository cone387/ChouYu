// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { resultReadingSelection } from './resultReadingSelection'
import { selectedCitation } from './deliveryReading'
afterEach(() => { window.getSelection()?.removeAllRanges(); document.body.replaceChildren() })
it('cites selected prose from its actual section, even when another section was last read', () => {
  document.body.innerHTML = '<div data-result-a2ui><section data-result-section="a"><div class="contact-markdown">第一节</div></section><section data-result-section="b"><div class="contact-markdown">第二节</div></section></div>'
  const text = document.querySelector('[data-result-section="b"] .contact-markdown')!.firstChild!
  const range = document.createRange(); range.setStart(text,0); range.setEnd(text,3)
  window.getSelection()!.addRange(range)
  const found = resultReadingSelection(document.body, 'a')!
  expect(found.sectionId).toBe('b')
  expect(selectedCitation({characterId:'owner',topicId:'task',version:2},{id:'b',title:'节',body:'第二节',runId:'run'},found.body).anchor?.quote).toBe('第二节')
  window.getSelection()!.removeAllRanges()
  expect(resultReadingSelection(document.body,'a')?.sectionId).toBe('a')
})
