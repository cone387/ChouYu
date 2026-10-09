import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import ContactTaskRequestLog from './ContactTaskRequestLog'
it('renders saved requests as inert text and handles missing history explicitly', () => {
  const html = renderToStaticMarkup(<ContactTaskRequestLog value={'用户：<script>alert(1)</script>\nChouYu：几点？\n用户：九点'} />)
  expect(html).toContain('&lt;script&gt;')
  expect(html).not.toContain('<script>')
  expect(html).toContain('几点？')
  expect(renderToStaticMarkup(<ContactTaskRequestLog />)).toContain('无法还原原始要求')
})
