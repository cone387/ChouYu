import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initTheme } from './core/theme'
import './styles/tokens.css'
import './styles/index.css'

initTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
