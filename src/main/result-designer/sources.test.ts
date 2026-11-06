import { afterEach, expect, it } from 'vitest'
import { ContactTaskStore } from '../task-center/contact-store'
import { ContactResultSources } from './sources'
const stores: ContactTaskStore[] = []
afterEach(() => stores.splice(0).forEach(s => s.close()))
function fixture() {
  const store = new ContactTaskStore(':memory:'); stores.push(store); store.ensure('author')
  const topic = store.topics.create('author',{title:'文章',goal:'写文章',constraints:''})
  const run = store.createRun('author','',Date.now(),topic.id)
  const progress = {status:'researching' as const,judgement:'已写正文',openQuestions:'',nextStep:'继续',reason:'交付正文'}
  const report = {runId:run,title:'第一节',body:'变更说明',nextStep:'继续',evidence:[],createdAt:Date.now()}
  const update = {completionCriteria:'完整正文',summary:'摘要',stages:[{id:'write',title:'写作',status:'active' as const}],section:{id:'one',title:'第一节',body:'真实正文'}}
  const sources = new ContactResultSources(store)
  return {store,topic,run,progress,report,update,sources,task:{domain:'contact' as const,ownerId:'author',taskId:topic.id}}
}
it('formalResultCommitEnqueuesAtomically', () => {
  const f = fixture()
  expect(() => f.store.db.transaction(() => { f.store.finish(f.run,f.report,[],f.progress,f.update); throw Error('rollback') })()).toThrow('rollback')
  expect(f.store.designs.pending()).toEqual([])
  f.store.finish(f.run,f.report,[],f.progress,f.update)
  expect(f.store.designs.pending()).toHaveLength(1)
  expect(f.store.designs.pending()[0].source).toMatchObject({ownerId:'author',taskId:f.topic.id,sourceId:'1'})
  f.store.finish(f.run,f.report,[],f.progress,f.update)
  expect(f.store.designs.pending()).toHaveLength(1)
})
it('respects source pause, completion, deletion and owner isolation', async () => {
  const f = fixture(); f.store.finish(f.run,f.report,[],f.progress,f.update)
  const snapshot = await f.sources.latest(f.task,new AbortController().signal)
  const setStatus = (status:string) => f.store.db.prepare("UPDATE topics SET value=json_set(value,'$.status',?) WHERE id=?").run(status,f.topic.id)
  setStatus('completed')
  await expect(f.sources.assertCurrent(snapshot!.ref,'automatic',new AbortController().signal)).resolves.toBeUndefined()
  setStatus('paused')
  await expect(f.sources.assertCurrent(snapshot!.ref,'automatic',new AbortController().signal)).rejects.toThrow(/暂停/)
  await expect(f.sources.assertCurrent(snapshot!.ref,'explicit',new AbortController().signal)).resolves.toBeUndefined()
  await expect(f.sources.read({...snapshot!.ref,ownerId:'someone-else'},new AbortController().signal)).rejects.toThrow()
  f.store.db.prepare('DELETE FROM topics WHERE id=?').run(f.topic.id)
  expect(f.store.designs.pending()).toEqual([])
  await expect(f.sources.read(snapshot!.ref,new AbortController().signal)).rejects.toThrow()
})
