import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ContactCardHighlights from './ContactCardHighlights'

it('provides separate semantic buttons for the exact question and saved delivery', () => {
  const html = renderToStaticMarkup(<ContactCardHighlights characterId="alice" highlights={{ pending: 'Which ending?', delivery: 'Story version 2', task: 'Drafting', sources: { pending: { characterId: 'alice', interactionId: 'question-1', topicId: 'story' }, delivery: { characterId: 'alice', topicId: 'story', version: 2 } } }} />)
  expect(html.match(/<button /g)).toHaveLength(2)
  expect(html).toContain('data-contact-card-pending="alice"')
  expect(html).toContain('data-contact-card-delivery="alice"')
  expect(html).not.toContain('[object Object]')
})
it('keeps older summaries readable without inventing a navigation source', () => {
  const html = renderToStaticMarkup(<ContactCardHighlights characterId="alice" highlights={{ pending: 'Legacy question', delivery: 'Legacy saved work' }} />)
  expect(html).toContain('Legacy question')
  expect(html).not.toContain('<button')
})
