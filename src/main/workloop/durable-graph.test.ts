import { expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Annotation, StateGraph, START, END } from '@langchain/langgraph'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { ContactStorageBarrier } from '../agent-space/storage-barrier'
import { invokeDurableGraph } from './durable-graph'
import { ContactBackups } from '../storage/contact-backups'

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
it('waits for delayed checkpoint persistence and resumes without replaying a completed model/tool step', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'contact-durable-'))
  const tasks = new Database(join(directory, 'agents.db')), checkpoints = new Database(join(directory, 'checkpoints.db'))
  const model = deferred(), checkpoint = deferred(), modelStarted = deferred(), checkpointStarted = deferred()
  try {
    tasks.exec("CREATE TABLE profiles(id TEXT); CREATE TABLE runs(id TEXT, phase INTEGER); INSERT INTO runs VALUES('run',0)")
    const saver = new SqliteSaver(checkpoints), put = saver.put.bind(saver), barrier = new ContactStorageBarrier()
    vi.spyOn(saver, 'put').mockImplementation(async (config, value, metadata) => {
      if (metadata.step === 1) { checkpointStarted.resolve(); await checkpoint.promise }
      return put(config, value, metadata)
    })
    const first = vi.fn(async () => { modelStarted.resolve(); await model.promise; tasks.exec("UPDATE runs SET phase=1"); return { phase: 1 } })
    const second = vi.fn(() => { tasks.exec("UPDATE runs SET phase=2"); return { phase: 2 } })
    const state = Annotation.Root({ phase: Annotation<number>() })
    const graph = new StateGraph(state).addNode('first', first).addNode('second', second)
      .addEdge(START, 'first').addEdge('first', 'second').addEdge('second', END).compile({ checkpointer: saver })
    const config = { configurable: { thread_id: 'run' } }
    const run = barrier.operation(lease => invokeDurableGraph(lease, (control, resume) => graph.invoke(resume ? null : {}, { ...config, control, durability: 'sync' })))
    await modelStarted.promise
    const backups = new ContactBackups(directory, { tasks, checkpoints }, operation => barrier.snapshot(operation))
    let published = false
    const copy = backups.create().then(group => { published = true; return group })
    const command = vi.fn()
    const queued = barrier.operation(command)
    model.resolve(); await checkpointStarted.promise
    expect(published).toBe(false); expect(command).not.toHaveBeenCalled(); expect(second).not.toHaveBeenCalled()
    checkpoint.resolve()
    const group = await copy
    await Promise.all([run, queued])
    const saved = new Database(join(directory, 'backups', group.id, 'tasks.db'), { readonly: true })
    try { expect(saved.prepare('SELECT phase FROM runs').get()).toEqual({ phase: 1 }) } finally { saved.close() }
    expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce()
    expect((await saver.getTuple(config))?.checkpoint.channel_values.phase).toBe(2)
  } finally { model.resolve(); checkpoint.resolve(); tasks.close(); checkpoints.close(); rmSync(directory, { recursive: true, force: true }) }
})
