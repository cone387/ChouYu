import { afterEach, expect, it } from 'vitest'
import { ContactTaskStore } from '../task-center/contact-store'
import { createDesignRun, DesignBudget } from './budget'
import { RESULT_DESIGNER_CHARACTER_ID as id } from '../../shared/result-design'
const stores:ContactTaskStore[]=[]
afterEach(()=>stores.splice(0).forEach(s=>s.close()))
it('reserves unknown usage under designer identity and enforces per-run token limit',()=>{
  const store=new ContactTaskStore(':memory:');stores.push(store);store.ensure(id)
  const run=createDesignRun(store), budget=new DesignBudget(store,run,2000)
  const reservation=budget.reserve('prompt',1000)
  expect(reservation.maxOutputTokens).toBe(1000)
  expect(store.callCount(id)).toBe(1)
  expect(()=>new DesignBudget(store,run,2000).reserve('prompt',1000)).toThrow(/额度/)
  expect(store.callCount(id)).toBe(1)
  budget.settle({finishReason:'stop',usage:{totalTokens:100}})
  expect(store.tokens.usage(id).today).toBe(100)
  expect(budget.reserve('prompt',1000).maxOutputTokens).toBe(1000)
})
