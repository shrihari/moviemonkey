import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import * as db from './lib/database'

// Expose database functions for dev console access
;(window as unknown as { db: typeof db }).db = db

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
