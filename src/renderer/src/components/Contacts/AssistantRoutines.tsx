import { DEFAULT_CHARACTER_ID } from '../../../../shared/characters'
import { ContactAgentPanel } from './ContactAgentPanel'

/** Settings uses exactly the same task workspace as the contact conversation. */
export default function AssistantRoutines({ active = true }: { active?: boolean }) {
  return active ? <ContactAgentPanel characterId={DEFAULT_CHARACTER_ID} name="ChouYu" compact selectedTab="work" /> : null
}