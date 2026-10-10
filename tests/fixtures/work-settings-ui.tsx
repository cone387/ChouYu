import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ContactWorkSettings from '../../src/renderer/src/components/Contacts/ContactWorkSettings'
import ContactTopics from '../../src/renderer/src/components/Contacts/ContactTopics'
import type { AgentOverview } from '../../src/shared/agents'
import '../../src/renderer/src/styles/index.css'
import '../../src/renderer/src/styles/tokens.css'
import '../../src/renderer/src/components/Contacts/ContactAgentPanel.css'

function Preview() {
  const [data, setData] = useState<AgentOverview>()
  const [key, setKey] = useState(true)
  useEffect(() => { void window.electronAPI.agents.get('settings-smoke').then(setData) }, [])
  if (data && new URLSearchParams(location.search).has('tasks')) return <main className="contact-agent" style={{ padding: 20, height: '100vh' }}>
    <ContactTopics characterId="settings-smoke" data={data} busy={false} settingsDirty={false}
      onAction={async action => { await action(); setData(await window.electronAPI.agents.get('settings-smoke')) }} onReport={() => {}} onAnalytics={() => {}} />
  </main>
  return <main className="contact-agent" style={{ padding: 20, margin: '0 auto' }}>
    {data && <ContactWorkSettings characterId="settings-smoke" data={data} keyConfigured={key} busy={false} onSaved={setData}
      onCredentialChanged={async () => { setKey((await window.electronAPI.agents.searchCredential('settings-smoke')).configured) }} />}
  </main>
}
createRoot(document.getElementById('root')!).render(<Preview />)
