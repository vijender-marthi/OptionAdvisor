import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { recoverFromStaleChunk } from './chunkRecovery'

// Vite fires this when a <link rel="modulepreload"> for a lazy chunk fails to load —
// typically a tab left open across a deploy. Reload once to fetch the fresh build.
window.addEventListener('vite:preloadError', event => {
  event.preventDefault()
  recoverFromStaleChunk()
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
