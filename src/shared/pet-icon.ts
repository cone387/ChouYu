export const PET_ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
  <circle cx="40" cy="44" r="28" fill="#6C5CE7"/>
  <ellipse cx="30" cy="38" rx="4" ry="5" fill="white"/>
  <ellipse cx="50" cy="38" rx="4" ry="5" fill="white"/>
  <circle cx="30" cy="39" r="2.5" fill="#2d2d2d"/>
  <circle cx="50" cy="39" r="2.5" fill="#2d2d2d"/>
  <path d="M 32 52 Q 40 58 48 52" stroke="#2d2d2d" fill="none" stroke-width="2" stroke-linecap="round"/>
  <circle cx="24" cy="48" r="4" fill="rgba(255,100,100,0.3)"/>
  <circle cx="56" cy="48" r="4" fill="rgba(255,100,100,0.3)"/>
</svg>`.trim()

// Windows tray icons require a raster source. Keeping the PNG inline avoids
// platform-specific SVG decoding failures that can otherwise produce an empty
// transparent nativeImage.
export const PET_ICON_PNG_BASE64 = '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'
