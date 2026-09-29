import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import WorkspaceNav from './WorkspaceNav'

it('shows unread chat counts while viewing another workspace page', () => {
  const html = renderToStaticMarkup(<WorkspaceNav activePage="tasks" onNavigate={() => {}} status="就绪" unreadCount={3} />)
  expect(html).toContain('会话，3 条未读消息')
  expect(html).toContain('class="workspace-nav-badge" aria-hidden="true">3</span>')
})

it('caps the badge but retains the accessible full count, and hides it after reading', () => {
  const render = (unreadCount: number) => renderToStaticMarkup(<WorkspaceNav activePage="chat" onNavigate={() => {}} status="就绪" unreadCount={unreadCount} />)
  expect(render(123)).toContain('>99+</span>')
  expect(render(123)).toContain('123 条未读消息')
  expect(render(0)).not.toContain('workspace-nav-badge')
})
