import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

describe('Tasks 视图源守卫', () => {
  test('键盘与可达性:表单原生提交、Esc 取消、行内按钮 aria-label、列表 role', () => {
    const source = read('TasksView.tsx')
    expect(source).toContain('onSubmit={submitDraft}')
    expect(source).toContain("key === 'Escape'")
    expect(source).toContain('aria-label')
    expect(source).toContain('role="list"')
    expect(source).toContain('data-priority')
    expect(source).not.toContain('window.prompt')
    expect(source).not.toContain('globalThis.prompt')
    expect(source).toContain('onSubmit={submitRename}')
    expect(source).toContain('role="dialog"')
    expect(source).toContain('aria-modal="true"')
    expect(source).toContain('tasks-dialog-backdrop')
    expect(source).toContain('tasks-new-project-form')
    expect(source).toContain('remindChoiceFromTask')
    expect(source).toContain('RECURRENCE_LABELS')
  })
  test('样式:使用全局 token、窄屏断点与减少动画', () => {
    const css = read('Tasks.css')
    for (const token of ['--bg-secondary', '--text-primary', '--border', '--accent', '--focus-ring']) {
      expect(css).toContain(`var(${token}`)
    }
    expect(css).toContain('max-width:')
    expect(css).toContain('prefers-reduced-motion')
  })
  test('导航注册 tasks 页', () => {
    const nav = read('../Workspace/WorkspaceNav.tsx')
    expect(nav).toContain("'tasks'")
    expect(nav).toContain('任务')
  })
})
