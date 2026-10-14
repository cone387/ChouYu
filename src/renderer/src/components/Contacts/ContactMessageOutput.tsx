import { useEffect, useState } from 'react'
import type { ContactCommunication } from '../../../../shared/contact-communication'
import type { ContactOutputDescriptor } from '../../../../shared/contact-output'
import ContactOutput from './ContactOutput'
import { contactQueries } from './contactQueries'
import { useContactOutputPreferences } from './useContactOutputPreferences'

export default function ContactMessageOutput({ body, communication, active = true }: { body: string; communication: ContactCommunication; active?: boolean }) {
  const source = communication.source
  const topicId = source.kind === 'task' ? source.topicId : undefined
  const artifact = source.kind === 'task' ? source.artifact : undefined
  const [descriptor, setDescriptor] = useState<ContactOutputDescriptor>()
  const preferences = useContactOutputPreferences(communication.characterId, topicId, artifact?.version, active)
  useEffect(() => {
    setDescriptor(undefined)
    if (!active || !topicId || !artifact) return
    let current = true
    void contactQueries.read(communication.characterId, 'delivery', [topicId, artifact.version], () => window.electronAPI.agents.delivery(communication.characterId, topicId, artifact.version))
      .then(delivery => { if (current) setDescriptor(delivery?.sections.find(section => section.id === artifact.sectionId)?.output) }).catch(() => {})
    return () => { current = false }
  }, [communication.characterId, topicId, artifact?.version, artifact?.sectionId, active])
  // Messages may intentionally deliver only one saved evaluation. Never replace their body with an entire section.
  return <ContactOutput body={body} descriptor={descriptor ?? (source.kind === 'proactive' ? { kind: 'briefing' } : undefined)} preferences={preferences} collapsible />
}
