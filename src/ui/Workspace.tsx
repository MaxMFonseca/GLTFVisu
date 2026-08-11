import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { useWorkspace } from '../application/WorkspaceController'
import { ErrorBoundary } from './common/ErrorBoundary'
import { PanelResizer } from './common/PanelResizer'
import { StatusRegion } from './common/StatusRegion'
import { ModelLoader } from './library/ModelLoader'
import { ShaderLibrary } from './library/ShaderLibrary'
import { ViewerHost, type ViewerMountFactory } from './viewer/ViewerHost'
import { ShaderEditorPanel, type ShaderSourceEditor } from './editor/ShaderEditorPanel'

const LEFT_MIN = 208
const LEFT_MAX = 420
const RIGHT_MIN = 288
const RIGHT_MAX = 620
const NARROW_QUERY = '(max-width: 64rem)'

const PANELS = [
  { id: 'library', label: 'Library', tabId: 'workspace-library-tab', panelId: 'shader-library-panel' },
  { id: 'viewer', label: 'Viewer', tabId: 'workspace-viewer-tab', panelId: 'shader-viewer-panel' },
  { id: 'editor', label: 'Editor', tabId: 'workspace-editor-tab', panelId: 'shader-editor-panel' },
] as const

type WorkspacePanel = (typeof PANELS)[number]['id']

interface WorkspaceStyle extends CSSProperties {
  '--left-panel-width': string
  '--right-panel-width': string
}

export interface WorkspaceProps {
  mountViewer?: ViewerMountFactory
  SourceEditor?: ShaderSourceEditor
}

function useNarrowWorkspace(): boolean {
  const [narrow, setNarrow] = useState(() => (
    typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches
  ))

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(NARROW_QUERY)
    const update = (event: MediaQueryListEvent) => setNarrow(event.matches)
    setNarrow(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return narrow
}

export function Workspace({ mountViewer, SourceEditor }: WorkspaceProps) {
  const { state, commands } = useWorkspace()
  const resizeViewer = useRef(commands.resizeViewer)
  resizeViewer.current = commands.resizeViewer
  const narrow = useNarrowWorkspace()
  const [activePanel, setActivePanel] = useState<WorkspacePanel>('viewer')
  const [leftWidth, setLeftWidth] = useState(260)
  const [rightWidth, setRightWidth] = useState(420)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const style: WorkspaceStyle = {
    '--left-panel-width': `${leftCollapsed ? 0 : leftWidth}px`,
    '--right-panel-width': `${rightCollapsed ? 0 : rightWidth}px`,
  }

  useEffect(() => {
    if (narrow && activePanel === 'viewer') resizeViewer.current()
  }, [activePanel, narrow])

  function activateWithKeyboard(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (event.currentTarget.closest('[inert]') !== null) return
    let nextIndex: number | undefined
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % PANELS.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + PANELS.length) % PANELS.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = PANELS.length - 1
    if (nextIndex === undefined) return
    event.preventDefault()
    const next = PANELS[nextIndex]
    setActivePanel(next.id)
    document.getElementById(next.tabId)?.focus()
  }

  return (
    <div className="workspace-root" data-layout={narrow ? 'narrow' : 'desktop'}>
      <StatusRegion notices={state.notices} onDismiss={commands.clearNotices} />
      {narrow && (
        <div className="workspace-tabs" role="tablist" aria-label="Workspace panels">
          {PANELS.map((panel, index) => (
            <button
              id={panel.tabId}
              key={panel.id}
              type="button"
              role="tab"
              aria-controls={panel.panelId}
              aria-selected={activePanel === panel.id}
              tabIndex={activePanel === panel.id ? 0 : -1}
              onClick={(event) => {
                if (event.currentTarget.closest('[inert]') === null) setActivePanel(panel.id)
              }}
              onKeyDown={(event) => activateWithKeyboard(event, index)}
            >
              {panel.label}
            </button>
          ))}
        </div>
      )}
      <div className="workspace-shell" data-layout={narrow ? 'narrow' : 'desktop'} style={style}>
        <aside
          id="shader-library-panel"
          className="workspace-panel workspace-library"
          aria-label={narrow ? undefined : 'Shader library panel'}
          aria-labelledby={narrow ? 'workspace-library-tab' : undefined}
          role={narrow ? 'tabpanel' : undefined}
          hidden={narrow ? activePanel !== 'library' : leftCollapsed}
        >
          <ErrorBoundary panelName="Library">
            <ModelLoader />
            <ShaderLibrary />
          </ErrorBoundary>
        </aside>
        {!narrow && (
          <PanelResizer
            side="left"
            panelName="shader library"
            panelId="shader-library-panel"
            width={leftWidth}
            minWidth={LEFT_MIN}
            maxWidth={LEFT_MAX}
            collapsed={leftCollapsed}
            onWidthChange={setLeftWidth}
            onCollapsedChange={setLeftCollapsed}
          />
        )}

        <main
          id="shader-viewer-panel"
          className="workspace-viewer"
          aria-label={narrow ? undefined : 'Shader workspace'}
          aria-labelledby={narrow ? 'workspace-viewer-tab' : undefined}
          role={narrow ? 'tabpanel' : undefined}
          hidden={narrow && activePanel !== 'viewer'}
        >
          <ErrorBoundary panelName="Viewer"><ViewerHost mountViewer={mountViewer} /></ErrorBoundary>
        </main>

        {!narrow && (
          <PanelResizer
            side="right"
            panelName="shader editor"
            panelId="shader-editor-panel"
            width={rightWidth}
            minWidth={RIGHT_MIN}
            maxWidth={RIGHT_MAX}
            collapsed={rightCollapsed}
            onWidthChange={setRightWidth}
            onCollapsedChange={setRightCollapsed}
          />
        )}
        <aside
          id="shader-editor-panel"
          className="workspace-panel workspace-editor"
          aria-label={narrow ? undefined : 'Shader editor panel'}
          aria-labelledby={narrow ? 'workspace-editor-tab' : undefined}
          role={narrow ? 'tabpanel' : undefined}
          hidden={narrow ? activePanel !== 'editor' : rightCollapsed}
        >
          <ErrorBoundary panelName="Editor"><ShaderEditorPanel SourceEditor={SourceEditor} /></ErrorBoundary>
        </aside>
      </div>
    </div>
  )
}
