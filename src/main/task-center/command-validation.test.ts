import { expect, it } from 'vitest'
import { validateContactCommand } from '../../shared/contact-commands'
import { TaskCenter } from './service'
import { createTodoDomain } from './todo-domain'
import { openTasksStore } from '../tasks/store'

it('rejects malformed wire envelopes and wrong revision primitive types', () => {
  expect(() => validateContactCommand('constructor', 'alice', [])).toThrow()
  expect(() => validateContactCommand('get', 'alice', {})).toThrow()
  expect(() => validateContactCommand('get', '', [])).toThrow()
  expect(() => validateContactCommand('deleteTopic', 'alice', ['topic', '1'])).toThrow()
  expect(() => validateContactCommand('deleteTopic', 'alice', ['topic', 1])).not.toThrow()
})

it('validates dynamic domain calls and invalidates old bindings after replacement', () => {
  const store = openTasksStore(':memory:'), center = new TaskCenter()
  try {
    const registration = center.register(createTodoDomain(store)), bound = registration.bind('user')
    expect(() => center.dispatchUnknown({ domain: 'todo', owner: 'user' }, 'assignTopic', [])).toThrow()
    expect(() => center.dispatchUnknown({ domain: 'todo', owner: 'user' }, 'getTask', {})).toThrow()
    expect(() => center.dispatchUnknown({ domain: 'todo', owner: 'other' }, 'getTask', ['id'])).toThrow()
    registration.dispose(); center.register(createTodoDomain(store))
    expect(() => bound.getTask('id')).toThrow('已卸载')
  } finally { store.close() }
})
