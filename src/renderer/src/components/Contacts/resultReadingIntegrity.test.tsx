// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { deliveryText } from '../../../../shared/contact-content'
import { resultReadingDOMText } from '../../../../shared/result-reading-integrity'
import ContactMarkdown from './ContactMarkdown'
import { selectedCitation, highlightAnchor } from './deliveryReading'
it('keeps footnote links scoped to each rendered section', () => {
  const host=document.createElement('div')
  host.innerHTML=renderToStaticMarkup(<><ContactMarkdown>{'First[^1].\n\n[^1]: Source A'}</ContactMarkdown><ContactMarkdown>{'Second[^1].\n\n[^1]: Source B'}</ContactMarkdown></>)
  const sections=host.querySelectorAll('.contact-markdown')
  const link=sections[1].querySelector<HTMLAnchorElement>('[data-footnote-ref]')!
  const targets=[...host.querySelectorAll('[id]')].filter(el=>el.id===link.getAttribute('href')!.slice(1))
  expect(targets).toHaveLength(1)
  expect(sections[1].contains(targets[0])).toBe(true)
})

it.each([
  'Before\n\n![architecture](https://example.com/image.png)\n\nAfter',
  'Claim[^1].\n\n[^1]: Source explanation',
  '| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nlet a = 1\n```'
])('checks Markdown prose without confusing generated navigation with saved words: %s', body => {
  const host = document.createElement('div');host.innerHTML=renderToStaticMarkup(<ContactMarkdown imageMode="link">{body}</ContactMarkdown>)
  expect(resultReadingDOMText(host).replace(/\s/g,'')).toBe(deliveryText(body).replace(/\s/g,''))
  expect(host.querySelector('img')).toBeNull()
  host.querySelector('.contact-markdown')!.append('伪造正文')
  expect(resultReadingDOMText(host).replace(/\s/g,'')).not.toBe(deliveryText(body).replace(/\s/g,''))
})
it.each(['Before\n\n![](https://example.com/image.png)\n\nAfter', 'Before\n\n![architecture](https://example.com/image.png)\n\nAfter', 'Before[^1].\n\nAfter\n\n[^1]: Explanation'])('cites prose and restores its original-text highlight after generated navigation: %s', body => {
  const host=document.createElement('div');document.body.append(host);host.innerHTML=renderToStaticMarkup(<ContactMarkdown imageMode="link">{body}</ContactMarkdown>)
  const container=host.querySelector<HTMLElement>('.contact-markdown')!, p=[...container.querySelectorAll('p')].find(p=>p.textContent==='After')!
  const range=document.createRange();range.selectNodeContents(p);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range)
  const citation=selectedCitation({characterId:'a',topicId:'t',version:1},{id:'s',title:'正文',body,runId:'r'},container)
  expect(citation.anchor?.quote).toBe('After')
  expect(citation.anchor?.start).toBe(deliveryText(body).indexOf('After'))
  host.innerHTML=renderToStaticMarkup(<ContactMarkdown>{body}</ContactMarkdown>)
  for(const el of host.querySelectorAll('*'))Object.assign(el,{scrollIntoView:()=>{}})
  highlightAnchor(host.querySelector('.contact-markdown')!,body,citation.anchor!)
  expect(window.getSelection()!.toString()).toBe('After')
  window.getSelection()!.removeAllRanges();host.remove()
})
