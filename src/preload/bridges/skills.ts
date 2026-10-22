
import type { IpcRenderer } from 'electron'

export function createSkillsBridge(ipcRenderer: IpcRenderer) {

return {
  skills: {
    runtimeStatus: id => ipcRenderer.invoke('skills:runtime-status', id),
    workFiles: owner => ipcRenderer.invoke('skills:work-files', owner),
    prepareRuntime: () => ipcRenderer.invoke('skills:prepare-runtime'),
    prepareDependencies: (owner, id) => ipcRenderer.invoke('skills:prepare-dependencies', owner, id),
    logs: (owner, id) => ipcRenderer.invoke('skills:logs', owner, id),
    browse: query => ipcRenderer.invoke('skills:browse', query),
    categories: () => ipcRenderer.invoke('skills:categories'),
    status: () => ipcRenderer.invoke('skills:status'),
    setup: () => ipcRenderer.invoke('skills:setup'),
    search: query => ipcRenderer.invoke('skills:search', query),
    install: id => ipcRenderer.invoke('skills:install', id),
    cancel: () => ipcRenderer.invoke('skills:cancel'),
    list: id => ipcRenderer.invoke('skills:list', id),
    detail: id => ipcRenderer.invoke('skills:detail', id),
    configure: (owner, id, action, revision) => ipcRenderer.invoke('skills:configure', owner, id, action, revision),
    uninstall: id => ipcRenderer.invoke('skills:uninstall', id)
  } satisfies import('../../shared/skills').SkillAPI
}
}
