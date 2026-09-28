export default function ContactTaskIcon({ name }: { name: 'play' | 'pause' | 'settings' }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'play' ? <path d="m8 5 11 7-11 7z" /> : name === 'pause' ? <><path d="M7 5h3v14H7zM14 5h3v14h-3z" /></> : <><path d="m9 3-.6 2.4-2 .9L4 5.7 2 9l1.8 1.8v2.4L2 15l2 3.3 2.4-.6 2 .9L9 21h6l.6-2.4 2-.9 2.4.6 2-3.3-1.8-1.8v-2.4L22 9l-2-3.3-2.4.6-2-.9L15 3z" /><circle cx="12" cy="12" r="3" /></>}
  </svg>
}
