import { expectTypeOf, it } from 'vitest'
import type { TaskCenter } from './service'
import type { AgentSpace } from '../agent-space/service'
import type { AgentDelivery } from '../../shared/agent-delivery'
import type { TaskRecord } from '../../shared/tasks'

function compileContracts(center: TaskCenter, space: AgentSpace) {
  const task = center.execute({ domain: 'todo', owner: 'user' }, 'getTask', ['task'])
  expectTypeOf(task).toEqualTypeOf<TaskRecord | null>()
  // @ts-expect-error A todo scope cannot invoke a contact command.
  center.execute({ domain: 'todo', owner: 'user' }, 'assignTopic', ['write'])
  // @ts-expect-error Revisions are numeric, never string coercions.
  space.request('deleteTopic', 'alice', ['topic', '1'])
  // @ts-expect-error Unknown methods are accepted only by the explicit dynamic boundary.
  space.request('madeUp', 'alice', [])
  const delivery = space.request('delivery', 'alice', ['topic', 1])
  expectTypeOf(delivery).toEqualTypeOf<Promise<AgentDelivery | null>>()
  // @ts-expect-error Saved delivery is not a user todo.
  const wrong: Promise<TaskRecord> = delivery
  void wrong
}
it('keeps compile-time contracts in the normal TypeScript project', () => {
  expectTypeOf(compileContracts).toBeFunction()
})

