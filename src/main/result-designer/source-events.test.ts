import { expect, it } from 'vitest'
import { ResultSourceEvents, routineSourceEvent } from './source-events'
it('routineOutboxSurvivesProcessExit and only acknowledges the accepted version', async () => {
  const event = routineSourceEvent(JSON.stringify([{id:'r',title:'晨报',enabled:true}]),'r',JSON.stringify([{id:'execution-1',status:'completed',content:'真实总结'}]))!
  let saved = JSON.stringify({r:event}), fail = true, accepted = 0
  const deps = {read:()=>saved,write:(v:string)=>{saved=v},accept:async()=>{if(fail)throw Error('worker offline'); accepted++}}
  await expect(new ResultSourceEvents(deps).drain()).rejects.toThrow('offline')
  expect(JSON.parse(saved).r.snapshot.ref.sourceId).toBe('execution-1')
  fail=false; await new ResultSourceEvents(deps).drain()
  expect(accepted).toBe(1); expect(JSON.parse(saved)).toEqual({})
  expect(routineSourceEvent('[{"id":"r","title":"晨报"}]','r','[{"id":"e","status":"failed","content":"不能当成果"}]')).toBeNull()
})
it('does not erase a newer source event arriving during delivery', async () => {
  const event = routineSourceEvent('[{"id":"r","title":"晨报","enabled":true}]','r','[{"id":"e1","status":"completed","content":"one"}]')!
  const next = routineSourceEvent('[{"id":"r","title":"晨报","enabled":true}]','r','[{"id":"e2","status":"completed","content":"two"}]')!
  let saved = JSON.stringify({r:event}), n=0
  const outbox = new ResultSourceEvents({read:()=>saved,write:v=>{saved=v},accept:async()=>{if(!n++)saved=JSON.stringify({r:next})}})
  await outbox.drain()
  expect(JSON.parse(saved).r.snapshot.ref.sourceId).toBe('e2')
})
it('does not let one unavailable source starve independent later results',async()=>{
  const event=routineSourceEvent('[{"id":"r","title":"Result","enabled":true}]','r','[{"id":"e","status":"completed","content":"body"}]')!
  let saved=JSON.stringify({bad:event,good:{...event,revision:2}})
  const accepted:number[]=[]
  const outbox=new ResultSourceEvents({read:()=>saved,write:v=>{saved=v},accept:async e=>{if(e.revision!==2)throw Error('offline');accepted.push(e.revision)}})
  await expect(outbox.drain()).rejects.toThrow('offline')
  expect(accepted).toEqual([2]);expect(Object.keys(JSON.parse(saved))).toEqual(['bad'])
})
