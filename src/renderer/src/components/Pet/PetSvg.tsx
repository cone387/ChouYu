import { PetState } from '../../shared/types'

interface PetSvgProps {
  state: PetState
}

export default function PetSvg({ state }: PetSvgProps) {
  const getMouth = () => {
    switch (state) {
      case 'thinking':
        return <path d="M 32 52 Q 36 50 40 52 Q 44 50 48 52" stroke="#2d2d2d" fill="none" strokeWidth="2" strokeLinecap="round" />
      case 'talking':
        return <ellipse cx="40" cy="53" rx="4" ry="3" fill="#2d2d2d" />
      case 'sleeping':
        return <path d="M 36 52 Q 40 54 44 52" stroke="#2d2d2d" fill="none" strokeWidth="1.5" strokeLinecap="round" />
      case 'happy':
        return <path d="M 30 50 Q 40 60 50 50" stroke="#2d2d2d" fill="none" strokeWidth="2" strokeLinecap="round" />
      default:
        return <path d="M 32 52 Q 40 58 48 52" stroke="#2d2d2d" fill="none" strokeWidth="2" strokeLinecap="round" />
    }
  }

  const getEyes = () => {
    switch (state) {
      case 'sleeping':
        return (
          <>
            <path d="M 26 38 L 34 38" stroke="#2d2d2d" strokeWidth="2" strokeLinecap="round" />
            <path d="M 46 38 L 54 38" stroke="#2d2d2d" strokeWidth="2" strokeLinecap="round" />
          </>
        )
      case 'happy':
        return (
          <>
            <path d="M 26 38 Q 30 34 34 38" stroke="#2d2d2d" strokeWidth="2" strokeLinecap="round" fill="none" />
            <path d="M 46 38 Q 50 34 54 38" stroke="#2d2d2d" strokeWidth="2" strokeLinecap="round" fill="none" />
          </>
        )
      default:
        return (
          <>
            <ellipse cx="30" cy="38" rx="4" ry="5" fill="white" />
            <ellipse cx="50" cy="38" rx="4" ry="5" fill="white" />
            <circle className="eye-pupil" cx="30" cy="39" r="2.5" fill="#2d2d2d" />
            <circle className="eye-pupil" cx="50" cy="39" r="2.5" fill="#2d2d2d" />
          </>
        )
    }
  }

  return (
    <svg width="80" height="80" viewBox="0 0 80 80" className="pet-svg">
      <circle cx="40" cy="44" r="28" fill="#6C5CE7" />
      {getEyes()}
      {getMouth()}
      <circle cx="24" cy="48" r="4" fill="rgba(255,100,100,0.3)" />
      <circle cx="56" cy="48" r="4" fill="rgba(255,100,100,0.3)" />
      {state === 'sleeping' && (
        <text x="58" y="24" className="zzz-text" fontSize="12" fill="#666">Z</text>
      )}
    </svg>
  )
}
