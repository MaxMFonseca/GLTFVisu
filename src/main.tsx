import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/global.css'
import './styles/library.css'
import './styles/viewer.css'
import './styles/workspace.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('The application root is missing.')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
