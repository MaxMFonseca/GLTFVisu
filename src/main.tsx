import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import {
  PORTRAIT_HEIGHT,
  PORTRAIT_WIDTH,
  parsePortraitShaderId,
} from './capture/portraitConfig'
import './styles/tokens.css'
import './styles/global.css'
import './styles/library.css'
import './styles/viewer.css'
import './styles/workspace.css'
import './styles/editor.css'
import './styles/parameters.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('The application root is missing.')
}

const portraitShaderId = import.meta.env.DEV
  ? parsePortraitShaderId(window.location.search)
  : undefined

if (portraitShaderId !== undefined) {
  const host = document.createElement('div')
  host.style.width = `${PORTRAIT_WIDTH}px`
  host.style.height = `${PORTRAIT_HEIGHT}px`
  document.documentElement.style.width = `${PORTRAIT_WIDTH}px`
  document.documentElement.style.height = `${PORTRAIT_HEIGHT}px`
  document.body.style.width = `${PORTRAIT_WIDTH}px`
  document.body.style.height = `${PORTRAIT_HEIGHT}px`
  document.body.style.margin = '0'
  rootElement.style.width = `${PORTRAIT_WIDTH}px`
  rootElement.style.height = `${PORTRAIT_HEIGHT}px`
  rootElement.replaceChildren(host)
  void import('./capture/renderBuiltinPortrait').then(({ renderBuiltinPortrait }) => (
    renderBuiltinPortrait(host, portraitShaderId)
  ))
} else {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
