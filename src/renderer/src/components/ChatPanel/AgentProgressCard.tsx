import { progressLabel, type AgentProgressUpdate } from '../../../../shared/agent-progress'
import './AgentProgressCard.css'

export default function AgentProgressCard({ update }: { update: AgentProgressUpdate }) {
  return <section className="agent-progress-card" aria-label="工作进展">
    <div className="agent-progress-status">{progressLabel(update.outcome)}</div>
    <p className="agent-progress-task">{update.taskTitle}</p>
    {update.title && <h3>{update.title}</h3>}
    <p className="agent-progress-summary">{update.summary}</p>
    {update.nextStep && !['completed', 'abandoned'].includes(update.outcome) && <div className="agent-progress-next"><span>接下来</span><p>{update.nextStep}</p></div>}
  </section>
}
