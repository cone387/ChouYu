import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ConfirmProvider from './components/common/ConfirmProvider'
import Journal from './components/Journal/Journal'
import { initTheme } from './core/theme'
import { initSelectInteractions } from './core/select'
import { initEscapeInteractions } from './core/escape'
import './styles/tokens.css'
import './styles/index.css'

initTheme()
initSelectInteractions()
initEscapeInteractions()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfirmProvider>{new URLSearchParams(window.location.search).get('view') === 'journal' ? <Journal /> : <App />}</ConfirmProvider>
  </React.StrictMode>
)
