import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import Journal from './components/Journal/Journal'
import { initTheme } from './core/theme'
import { initSelectInteractions } from './core/select'
import './styles/tokens.css'
import './styles/index.css'

initTheme()
initSelectInteractions()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get('view') === 'journal' ? <Journal /> : <App />}
  </React.StrictMode>
)
