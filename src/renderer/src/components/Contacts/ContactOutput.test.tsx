import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ContactOutput from './ContactOutput'

it.each(['writing', 'ideas', 'review', 'research', 'plan', 'briefing', 'plain'])('renders complete %s content with the shared safe Markdown renderer', kind => {
  const body = '# 原标题\n\n实际结论。\n\n| 证据 | 判断 |\n| --- | --- |\n| 来源 A | 尚待核实 |\n\n最后一段完整保留。'
  const html = renderToStaticMarkup(<ContactOutput body={body} descriptor={{ kind, density: 'comfortable' }} />)
  expect(html).toContain(`data-contact-output="${kind}"`)
  expect(html).toContain('最后一段完整保留。')
  expect(html).toContain('<table>')
})
it('keeps long text in the expandable output and strips executable markup from unknown presentation', () => {
  const body = '真实正文。\n\n'.repeat(700) + '\n结尾不可丢失。\n<script>danger()</script>'
  const html = renderToStaticMarkup(<ContactOutput body={body} descriptor={{ kind: 'unsafe', html: '<script>run()</script>' }} collapsible />)
  expect(html).toContain('<details')
  expect(html).toContain('结尾不可丢失。')
  expect(html).toContain('data-contact-output="plain"')
  expect(html).not.toContain('<script>')
})
it('applies the same explicit preference override without changing the body', () => {
  const html = renderToStaticMarkup(<ContactOutput body="不可改写的正文" descriptor={{ kind: 'review' }} preferences={[{ kind: 'writing', density: 'compact' }]} />)
  expect(html).toContain('data-contact-output="writing"')
  expect(html).toContain('data-output-density="compact"')
  expect(html).toContain('不可改写的正文')
})
