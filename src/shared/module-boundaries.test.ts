import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const { checkSource } = require('../../scripts/check-module-boundaries.cjs') as {
  checkSource(file: string, source: string): { from: string; to: string; reason: string }[]
}

it.each([
  ['src/shared/a.ts', "import type { Config } from '../main/database'"],
  ['src/shared/a.ts', "export { x } from '../renderer/src/App'"],
  ['src/shared/a.ts', "import type { BrowserWindow } from 'electron'"],
  ['src/main/agents/a.ts', "const ipc = require('../ipc')"],
  ['src/main/contact-agent/a.ts', "import '../ipc/agents'"],
  ['src/main/workloop/a.ts', "import '../../renderer/src/App'"],
  ['src/main/messaging/a.ts', "export * from '../ipc/sessions'"],
  ['src/main/storage/a.ts', "import '../ipc'"],
  ['src/main/workloop/a.ts', "import '../harness/native/runner'"],
  ['src/main/task-center/a.ts', "import '../harness/dsh/runtime'"],
  ['src/main/task-center/a.ts', "const view = import('../../renderer/src/App')"],
  ['src/renderer/src/components/Tasks/a.ts', "type Page = import('../Settings/Settings').default"],
  ['src/renderer/src/components/Tasks/a.ts', "import Settings from '@/components/Settings/Settings'"]
])('reports a forbidden dependency with its real endpoints: %s %s', (file, source) => {
  const errors = checkSource(file, source)
  expect(errors).toHaveLength(1)
  expect(errors[0].from).toBe(file)
  expect(errors[0].to).not.toBe('')
  expect(errors[0].reason).not.toBe('')
})

it('permits shared contracts, workspace composition and reusable contact components', () => {
  expect(checkSource('src/main/task-center/a.ts', "import { Task } from '../../shared/tasks'")).toEqual([])
  expect(checkSource('src/renderer/src/components/Workspace/Workspace.tsx', "import Tasks from '../Tasks/TasksView'")).toEqual([])
  expect(checkSource('src/renderer/src/components/ChatPanel/a.ts', "import Citation from '../Contacts/ContactCitation'")).toEqual([])
})
