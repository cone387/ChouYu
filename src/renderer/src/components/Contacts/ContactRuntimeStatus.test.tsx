import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ContactRuntimeDetails } from './ContactRuntimeStatus'

it('shows an unavailable runtime without claiming there are zero tasks running', () => {
  const html = renderToStaticMarkup(<ContactRuntimeDetails snapshot={{ phase: 'unavailable', generation: 2, revision: 4, restartCount: 1, issue: { kind: 'storage', at: 100 } }} onRetry={() => {}} />)
  expect(html).toContain('后台工作暂不可用')
  expect(html).toContain('重试连接')
  expect(html).toContain('联系人存储暂不可用')
  expect(html).not.toContain('运行中 0')
})
it('keeps healthy runtime details secondary and exposes actual pending delivery counts', () => {
  const html = renderToStaticMarkup(<ContactRuntimeDetails snapshot={{ phase: 'ready', generation: 1, revision: 4, restartCount: 0, metrics: { observedAt: 100, activeRuns: 2, capacity: 8, pendingDeliveries: 3 } }} onRetry={() => {}} />)
  expect(html).toContain('<details')
  expect(html).toContain('待投递 3')
  expect(html).not.toContain('重试连接')
})
