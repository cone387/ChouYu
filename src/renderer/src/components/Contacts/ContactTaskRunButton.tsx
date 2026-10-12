import ContactTaskIcon from './ContactTaskIcon'

export default function ContactTaskRunButton({ pause, label, disabled, title, onClick, toolbar = false }: {
  pause: boolean; label: string; disabled: boolean; title: string; onClick: () => void; toolbar?: boolean
}) {
  return <button type="button" className="primary" data-topic-run={!toolbar && !pause || undefined} data-topic-pause={!toolbar && pause || undefined} data-current-task-action={toolbar ? pause ? 'pause' : 'continue' : undefined}
    title={title} disabled={disabled} onClick={onClick}><ContactTaskIcon name={pause ? 'pause' : 'play'} />{label}</button>
}
