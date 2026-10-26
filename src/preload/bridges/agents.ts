import type { AgentAPI } from '../../shared/agents'
import type { IpcRenderer } from 'electron'

export function createAgentsBridge(ipcRenderer: IpcRenderer) {

return {
  agents: {
    runtimeStatus: () => ipcRenderer.invoke('agents:runtime-status'),
    retryRuntime: () => ipcRenderer.invoke('agents:retry-runtime'),
    restoreRuntime: (groupId: string) => ipcRenderer.invoke('agents:restore-runtime', groupId),
    onRuntimeChanged: callback => {
      const listener = (_event: unknown, state: import('../../shared/contact-runtime').ContactRuntimeSnapshot) => callback(state)
      ipcRenderer.on('agents:runtime-changed', listener)
      return () => { ipcRenderer.removeListener('agents:runtime-changed', listener) }
    },
    dashboard: () => ipcRenderer.invoke('agents:dashboard'),
    summary: id => ipcRenderer.invoke('agents:summary', id),
    analytics: (id, query) => ipcRenderer.invoke('agents:analytics', id, query),
    interactions: (id, topicId, cursor) => ipcRenderer.invoke('agents:interactions', id, topicId, cursor),
    delivery: (id, topicId, version) => ipcRenderer.invoke('agents:delivery', id, topicId, version),
    deliveryFeedback: (id, topicId, revision, version, action, reason, requestId, citation, scope) => ipcRenderer.invoke('agents:deliveryFeedback', id, topicId, revision, version, action, reason, requestId, citation, scope),
    deliveryFeedbackList: (id, topicId) => ipcRenderer.invoke('agents:deliveryFeedbackList', id, topicId),
    portfolio: (id, query) => ipcRenderer.invoke('agents:portfolio', id, query),
    prepareHandoff: (owner, request) => ipcRenderer.invoke('agents:prepareHandoff', owner, request),
    commitHandoff: (owner, preparation) => ipcRenderer.invoke('agents:commitHandoff', owner, preparation),
    handoffs: (owner, topicId) => ipcRenderer.invoke('agents:handoffs', owner, topicId),
    fileList: (owner, topicId) => ipcRenderer.invoke('agents:fileList', owner, topicId),
    contactHome: owner => ipcRenderer.invoke('agents:contactHome', owner),
    readContactFile: (owner, id) => ipcRenderer.invoke('agents:readContactFile', owner, id),
    exportContactFile: (owner, id) => ipcRenderer.invoke('agents:exportContactFile', owner, id),
    handoffState: (owner, id) => ipcRenderer.invoke('agents:handoffState', owner, id),
    returnReview: (owner, request) => ipcRenderer.invoke('agents:returnReview', owner, request),
    materialList: (id, context) => ipcRenderer.invoke('agents:materialList', id, context),
    saveMaterial: (id, input, materialId, version) => ipcRenderer.invoke('agents:saveMaterial', id, input, materialId, version),
    cancelMaterialImport: (id, requestId) => ipcRenderer.invoke('agents:cancelMaterialImport', id, requestId),
    importMaterial: (id, input) => ipcRenderer.invoke('agents:importMaterial', id, input),
    readMaterial: (id, context, ref, offset) => ipcRenderer.invoke('agents:readMaterial', id, context, ref, offset),
    materialHistory: (id, materialId) => ipcRenderer.invoke('agents:materialHistory', id, materialId),
    withdrawMaterial: (id, materialId, version) => ipcRenderer.invoke('agents:withdrawMaterial', id, materialId, version),
    materialInventory: id => ipcRenderer.invoke('agents:materialInventory', id),
    purgeMaterial: (id, materialId, version) => ipcRenderer.invoke('agents:purgeMaterial', id, materialId, version),
    memoryList: id => ipcRenderer.invoke('agents:memoryList', id),
    createMemory: (id, input) => ipcRenderer.invoke('agents:createMemory', id, input),
    updateMemory: (id, memoryId, revision, input) => ipcRenderer.invoke('agents:updateMemory', id, memoryId, revision, input),
    memoryHistory: (id, memoryId) => ipcRenderer.invoke('agents:memoryHistory', id, memoryId),
    forgetMemory: (id, memoryId, revision) => ipcRenderer.invoke('agents:forgetMemory', id, memoryId, revision),
    validateCitation: (id, citation) => ipcRenderer.invoke('agents:validateCitation', id, citation),
    reviseCitation: (id, revision, citation, feedback) => ipcRenderer.invoke('agents:reviseCitation', id, revision, citation, feedback),
    setDeliveryFavorite: (id, topicId, value) => ipcRenderer.invoke('agents:setDeliveryFavorite', id, topicId, value),
    saveDeliveryReading: (id, position) => ipcRenderer.invoke('agents:saveDeliveryReading', id, position),
    deliveryReading: (id, topicId) => ipcRenderer.invoke('agents:deliveryReading', id, topicId),
    exportDelivery: (id, topicId, version, format) => ipcRenderer.invoke('agents:exportDelivery', id, topicId, version, format),
    pendingInteractions: (id: string) => ipcRenderer.invoke('agents:pendingInteractions', id),
    getInteraction: (id, interactionId) => ipcRenderer.invoke('agents:getInteraction', id, interactionId),
    outputPreferences: (id, topicId, version) => ipcRenderer.invoke('agents:outputPreferences', id, topicId, version),
    profile: id => ipcRenderer.invoke('agents:profile', id),
    setOutputPreference: (id, scope, revision, patch) => ipcRenderer.invoke('agents:setOutputPreference', id, scope, revision, patch),
    submitInteraction: (id, interactionId, submission) => ipcRenderer.invoke('agents:submitInteraction', id, interactionId, submission),
    setTaskBudget: (id, topicId, revision, budget) => ipcRenderer.invoke('agents:setTaskBudget', id, topicId, revision, budget),
    continueTopic: (id, topicId, revision, reason, requestId) => ipcRenderer.invoke('agents:continueTopic', id, topicId, revision, reason, requestId),
    reviseTopic: (id, topicId, revision, feedback, sectionId, scope, deliveryVersion) => ipcRenderer.invoke('agents:reviseTopic', id, topicId, revision, feedback, sectionId, scope, deliveryVersion),
    searchCredential: (id, key, revision) => ipcRenderer.invoke('agents:searchCredential', id, key, revision),
    get: id => ipcRenderer.invoke('agents:get', id),
    save: (id, settings) => ipcRenderer.invoke('agents:save', id, settings),
    run: (id, topicId, failedRunId) => ipcRenderer.invoke('agents:run', id, topicId, failedRunId),
    createTopic: (id, input) => ipcRenderer.invoke('agents:createTopic', id, input),
    assignTopic: (id, description) => ipcRenderer.invoke('agents:assignTopic', id, description),
    deleteTopic: (id, topicId, revision) => ipcRenderer.invoke('agents:deleteTopic', id, topicId, revision),
    savePreferences: (id, settings, revision) => ipcRenderer.invoke('agents:savePreferences', id, settings, revision),
    editTopic: (id, topicId, revision, input, reason) => ipcRenderer.invoke('agents:editTopic', id, topicId, revision, input, reason),
    topicStatus: (id, topicId, revision, status, reason) => ipcRenderer.invoke('agents:topicStatus', id, topicId, revision, status, reason),
    focusTopic: (id, topicId) => ipcRenderer.invoke('agents:focusTopic', id, topicId),
    topicDetail: (id, topicId, cursor) => ipcRenderer.invoke('agents:topicDetail', id, topicId, cursor),
    pause: id => ipcRenderer.invoke('agents:pause', id),
    detail: (id, runId) => ipcRenderer.invoke('agents:detail', id, runId),
    answer: (id, runId, answer, inputs) => ipcRenderer.invoke('agents:answer', id, runId, answer, inputs),
    remember: (id, content) => ipcRenderer.invoke('agents:remember', id, content),
    forget: (id, memoryId) => ipcRenderer.invoke('agents:forget', id, memoryId),
    onChanged: callback => {
      const handler = (_event: unknown, id: string) => callback(id)
      ipcRenderer.on('agents:changed', handler)
      return () => ipcRenderer.removeListener('agents:changed', handler)
    }
  } satisfies AgentAPI
}
}
