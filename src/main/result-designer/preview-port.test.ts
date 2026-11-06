import {expect,it} from 'vitest'
import {WorkerPreviewPort,type PreviewInput,type PreviewRequest} from './preview-port'
it('closes cancelled sessions and waits for the host close acknowledgement',async()=>{
  const messages:PreviewRequest[]=[], port=new WorkerPreviewPort(m=>messages.push(m)), abort=new AbortController()
  const opening=port.open({} as PreviewInput,abort.signal)
  port.receive(messages[0].sequence,'session');const session=await opening
  abort.abort();expect(messages[1]).toMatchObject({operation:'close',sessionId:'session'})
  let done=false;const closing=session.close().then(()=>{done=true});await Promise.resolve();expect(done).toBe(false)
  port.receive(messages[1].sequence,undefined);await closing;expect(done).toBe(true)
  expect(()=>session.inspect()).toThrow()
})
