import type { JournalAPI } from '../../shared/journal'
import type { IpcRenderer } from 'electron'

export function createJournalBridge(ipcRenderer: IpcRenderer) {

return {
  journal: {
    retrySavedOcr: (id) => ipcRenderer.invoke('journal:retrySavedOcr', id),
    onBookmarkSaved: (callback) => {
      const handler = (_event: unknown, id: string) => callback(id)
      ipcRenderer.on('journal:bookmark-saved', handler)
      return () => { ipcRenderer.removeListener('journal:bookmark-saved', handler) }
    },
    generateContinuations: (input) => ipcRenderer.invoke('journal:generateContinuations', input),
    saveItem: (input) => ipcRenderer.invoke('journal:saveItem', input),
    savedImage: (input) => ipcRenderer.invoke('journal:savedImage', input),
    updateSaved: (input) => ipcRenderer.invoke('journal:updateSaved', input),
    deleteSaved: (input) => ipcRenderer.invoke('journal:deleteSaved', input),
    savedItems: () => ipcRenderer.invoke('journal:savedItems'),
    projects: () => ipcRenderer.invoke('journal:projects'),
    weeklySources: range => ipcRenderer.invoke('journal:weeklySources', range),
    weekly: () => ipcRenderer.invoke('journal:weekly'),
    createWeekly: input => ipcRenderer.invoke('journal:createWeekly', input),
    editWeekly: input => ipcRenderer.invoke('journal:editWeekly', input),
    deleteWeekly: input => ipcRenderer.invoke('journal:deleteWeekly', input),
    exportWeekly: input => ipcRenderer.invoke('journal:exportWeekly', input),
    playbook: () => ipcRenderer.invoke('journal:playbook'),
    savePlaybook: input => ipcRenderer.invoke('journal:savePlaybook', input),
    deletePlaybook: input => ipcRenderer.invoke('journal:deletePlaybook', input),
    exportPlaybook: input => ipcRenderer.invoke('journal:exportPlaybook', input),
    preparePlaybookMemory: input => ipcRenderer.invoke('journal:preparePlaybookMemory', input),
    confirmPlaybookMemory: token => ipcRenderer.invoke('journal:confirmPlaybookMemory', token),
    saveProject: input => ipcRenderer.invoke('journal:saveProject', input),
    deleteProject: id => ipcRenderer.invoke('journal:deleteProject', id),
    assignProject: input => ipcRenderer.invoke('journal:assignProject', input),
    prepareSemantic: query => ipcRenderer.invoke('journal:prepareSemantic', query),
    searchSemantic: id => ipcRenderer.invoke('journal:searchSemantic', id),
    clearSemanticCache: () => ipcRenderer.invoke('journal:clearSemanticCache'),
    cancelSemantic: () => ipcRenderer.invoke('journal:cancelSemantic'),
    savedUsage: () => ipcRenderer.invoke('journal:savedUsage'),
    open: () => ipcRenderer.invoke('journal:open'),
    status: () => ipcRenderer.invoke('journal:status'),
    configure: (patch) => ipcRenderer.invoke('journal:configure', patch),
    list: (query) => ipcRenderer.invoke('journal:list', query),
    tasks: (query) => ipcRenderer.invoke('journal:tasks', query),
    detail: (input) => ipcRenderer.invoke('journal:detail', input),
    editTask: (input) => ipcRenderer.invoke('journal:edit-task', input),
    deleteActivity: (id) => ipcRenderer.invoke('journal:delete-activity', id),
    deleteCapture: (id) => ipcRenderer.invoke('journal:delete-capture', id),
    captureInfo: (id) => ipcRenderer.invoke('journal:capture-info', id),
    deleteRange: (range) => ipcRenderer.invoke('journal:delete-range', range),
    captures: (query) => ipcRenderer.invoke('journal:captures', query),
    image: (id) => ipcRenderer.invoke('journal:image', id),
    retryOcr: (id) => ipcRenderer.invoke('journal:retry-ocr', id),
    summarize: (range) => ipcRenderer.invoke('journal:summarize', range),
    summary: (range) => ipcRenderer.invoke('journal:summary', range),
    analysisRecords: (range) => ipcRenderer.invoke('journal:analysis-records', range),
    overview: (range) => ipcRenderer.invoke('journal:overview', range),
    ask: (input) => ipcRenderer.invoke('journal:ask', input),
    cancelAnalysis: () => ipcRenderer.invoke('journal:cancel-analysis')
  } satisfies JournalAPI,

  onOpenJournalPanel: (callback: () => void) => {
    ipcRenderer.on('open-journal-panel', callback)
    return () => { ipcRenderer.removeListener('open-journal-panel', callback) }
  }
}
}
