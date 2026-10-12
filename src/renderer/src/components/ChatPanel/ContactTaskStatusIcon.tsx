import type { TaskState } from '../../../../shared/task-state'

/** Only actual execution animates; scheduled work and user waits remain still. */
export default function ContactTaskStatusIcon({ state }: { state: TaskState }) {
  const blocked = ['failed', 'task-budget', 'daily-limit', 'daily-budget', 'interrupted'].includes(state.code)
  return <span className="contact-current-task-status" data-task-status={state.code} role="img" aria-label={state.label} title={`${state.label}：${state.description}`}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {state.code === 'running' ? <><circle cx="12" cy="12" r="8" opacity=".2" /><path className="contact-task-running-arc" d="M12 4a8 8 0 0 1 8 8" /></>
        : state.code === 'paused' ? <><path d="M8 6v12M16 6v12" strokeWidth="3" /></>
          : state.code === 'waiting' ? <><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z" /><path d="M8 10h8M8 14h5" /></>
            : blocked ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 17h.01" /></>
              : ['manual', 'unscheduled'].includes(state.code) ? <path d="m8 5 11 7-11 7z" />
                : <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>}
    </svg>
  </span>
}
