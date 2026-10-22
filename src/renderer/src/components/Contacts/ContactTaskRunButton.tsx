import ContactTaskIcon from './ContactTaskIcon'
import type { TaskRecoveryInfo } from '../../../../shared/task-recovery'

export default function ContactTaskRunButton({ pause, label, disabled, title, onClick, toolbar = false, recovery }: {
  pause: boolean; label: string; disabled: boolean; title: string; onClick: () => void; toolbar?: boolean; recovery?: TaskRecoveryInfo
}) {
  return <button type="button" className="primary" data-topic-run={!toolbar && !pause || undefined} data-topic-pause={!toolbar && pause || undefined} data-current-task-action={toolbar ? pause ? 'pause' : 'continue' : undefined}
    title={recovery ? `${title}。${recovery.conditions.join(' ')}` : title} disabled={disabled || !pause && recovery?.unknownExternalResult} onClick={onClick}><ContactTaskIcon name={pause ? 'pause' : 'play'} />{label}</button>
}
