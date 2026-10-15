import {expect,it,vi} from 'vitest'
import {HarnessCoordinator} from './coordinator'
import type {HarnessInput} from './contracts'
const input=()=>({requestId:'r',attemptId:'a',characterId:'pilot',signal:new AbortController().signal,assertContext:async()=>{}} as HarnessInput)
it('keeps ordinary contacts on legacy and never falls back after a DSH failure',async()=>{
 const legacy={run:vi.fn(async()=>({state:'completed' as const,text:'legacy'}))},dsh={run:vi.fn(async()=>{throw new Error('dsh failed')})}
 const coordinator=new HarnessCoordinator({legacy,dsh},{CHOUYU_DSH_PILOT_CHARACTER_ID:'pilot'},'win32')
 expect(await coordinator.run({...input(),characterId:'other'},()=>{})).toMatchObject({state:'completed'})
 expect(await coordinator.run(input(),()=>{})).toMatchObject({state:'failed',error:'dsh failed'})
 expect(legacy.run).toHaveBeenCalledTimes(1);expect(dsh.run).toHaveBeenCalledTimes(1)
})
it('does not launch DSH on macOS or before an already cancelled request',async()=>{
 const run=vi.fn(),coordinator=new HarnessCoordinator({dsh:{run}},{CHOUYU_DSH_PILOT_CHARACTER_ID:'pilot'},'darwin')
 expect(await coordinator.run(input(),()=>{})).toMatchObject({state:'failed'})
 const abort=new AbortController();abort.abort()
 expect(await coordinator.run({...input(),signal:abort.signal},()=>{})).toMatchObject({state:'cancelled'})
 expect(run).not.toHaveBeenCalled()
})
