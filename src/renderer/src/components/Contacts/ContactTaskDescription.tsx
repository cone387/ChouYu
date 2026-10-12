export default function ContactTaskDescription({ id, question, value, disabled, onChange }: { id: string; question?: string; value: string; disabled?: boolean; onChange(value: string): void }) {
  return <><label htmlFor={id}>{question ? '补充说明' : '任务描述'}</label><textarea id={id} data-task-description autoFocus rows={question ? 3 : 6} maxLength={2000} required value={value} disabled={disabled} onChange={e => onChange(e.target.value)} placeholder={question ? '补充这个问题即可……' : '说说你想完成什么……'} /></>
}
