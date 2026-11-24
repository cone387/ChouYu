import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ResultReadingSources from './ResultReadingSources'

it('keeps a saved delivery reference actionable with its exact version', () => {
  const url = 'contact-delivery://author/task/section?version=3'
  const html = renderToStaticMarkup(<ResultReadingSources sources={[{ title: '原始评审', url }]} />)
  expect(html).toContain(`data-delivery-source="${url}"`)
  expect(html).toContain('<button')
})
it('keeps saved materials actionable and prevents unrecognized executable sources', () => {
  const html = renderToStaticMarkup(<ResultReadingSources sources={[
    { title: '固定资料', url: 'contact-material://author/material/2?start=0&end=10' },
    { title: '不可信来源', url: 'javascript:alert(1)' }
  ]} />)
  expect(html).toContain('<button')
  expect(html).toContain('固定资料')
  expect(html).not.toContain('href="javascript:')
})
