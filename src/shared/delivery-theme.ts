export const DELIVERY_THEME_TOKENS = {
  '--delivery-bg': '--bg-primary', '--delivery-surface': '--bg-secondary', '--delivery-text': '--text-primary',
  '--delivery-muted': '--text-secondary', '--delivery-accent': '--accent', '--delivery-border': '--border'
} as const

// Applied after author CSS. Original colors remain available through an explicit reader choice.
export const deliveryThemeCSS = `
:root{--delivery-bg:light-dark(#fff,#1c1d22);--delivery-surface:light-dark(#f7f8fa,#25262d);--delivery-text:light-dark(#1a1a1a,#f0f0f0);--delivery-muted:light-dark(#606572,#b0b2bd);--delivery-accent:light-dark(#6c5ce7,#a69aff);--delivery-border:light-dark(#ddd,#454650)}
:root[data-delivery-color-mode=system]{--bg:var(--delivery-bg)!important;--bg-card:var(--delivery-surface)!important;--bg-hover:var(--delivery-surface)!important;--fg:var(--delivery-text)!important;--fg-muted:var(--delivery-muted)!important;--accent:var(--delivery-accent)!important;--border:var(--delivery-border)!important;--border-soft:var(--delivery-border)!important}
html[data-delivery-color-mode=system] body{background:var(--delivery-bg)!important;color:var(--delivery-text)!important}
html[data-delivery-color-mode=system] #root,html[data-delivery-color-mode=system] #root *:not(svg):not(svg *){color:inherit!important;background-color:transparent!important;background-image:none!important;border-color:var(--delivery-border)!important;box-shadow:none!important}
html[data-delivery-color-mode=system] #root{color:var(--delivery-text)!important}
html[data-delivery-color-mode=system] #root :is(button,input,select,textarea){color:var(--delivery-text)!important;background-color:var(--delivery-surface)!important}
html[data-delivery-color-mode=system] #root :is(a,button.active,[aria-current=true],[aria-selected=true],[aria-pressed=true]){color:var(--delivery-accent)!important}
html[data-delivery-color-mode=system] #root :is(small,.book-meta,.section-info){color:var(--delivery-muted)!important}
.body{white-space:pre-wrap;overflow-wrap:anywhere}#root{min-width:0}#root :is(img,svg,video,canvas){max-width:100%}:focus-visible{outline:2px solid var(--delivery-accent)!important;outline-offset:3px}
`
