import {expect,it} from 'vitest'
import {ContactTaskStore} from '../task-center/contact-store'
import {validateDeliveryUpdate} from '../../shared/agent-delivery'
import {readStoredDelivery} from '../agents/delivery-blocks'
import {retireAuthorPresentation} from './retirement'
it('never returns legacy author code while retaining its formal prose',()=>{
  const store=new ContactTaskStore(':memory:')
  try{
    const legacy={version:1,runId:'r',sections:[{id:'s',title:'正文',body:'已保存正文'}],presentation:{title:'旧页',html:'<script>legacy()</script>',css:'',script:'legacy()'}}
    const read=readStoredDelivery(store.db,JSON.stringify(legacy))
    expect(read.sections[0].body).toBe('已保存正文');expect(read).not.toHaveProperty('presentation')
    expect(()=>validateDeliveryUpdate({...legacy,summary:'摘要',completionCriteria:'完成',stages:[{id:'s',title:'节',status:'done'}],section:legacy.sections[0]})).toThrow()
  }finally{store.close()}
})
it('retires pending author runs and cards and rejects late completion without forwarding',()=>{
  const store=new ContactTaskStore(':memory:')
  try{
    store.ensure('author');const topic=store.topics.create('author',{title:'Title',goal:'Write',constraints:''}),run=store.createRun('author','',Date.now(),topic.id)
    store.db.prepare("UPDATE runs SET input=json_set(input,'$.revisionScope','presentation'),status='running' WHERE id=?").run(run)
    store.db.prepare('INSERT INTO contact_interactions(id,character_id,value) VALUES(?,?,?)').run('old-card','author',JSON.stringify({status:'pending',runId:run,tool:'revise_contact_presentation'}))
    retireAuthorPresentation(store.db)
    expect(store.getRun(run)?.status).toBe('cancelled')
    expect(JSON.parse((store.db.prepare('SELECT value FROM contact_interactions WHERE id=?').get('old-card') as {value:string}).value).status).toBe('obsolete')
    expect(()=>store.finish(run,{runId:run,title:'late',body:'late',nextStep:'',evidence:[],createdAt:1},[])).toThrow(/旧作者展示/)
    expect(store.designs.pending()).toEqual([]);expect(store.deliveries.get(topic.id)).toBeNull()
  }finally{store.close()}
})
