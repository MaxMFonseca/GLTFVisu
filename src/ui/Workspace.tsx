import { useState, type CSSProperties } from 'react'
import { useWorkspace } from '../application/WorkspaceController'
import { ErrorBoundary } from './common/ErrorBoundary'
import { PanelResizer } from './common/PanelResizer'
import { ModelLoader } from './library/ModelLoader'
import { ShaderLibrary } from './library/ShaderLibrary'
import { ViewerHost, type ViewerMountFactory } from './viewer/ViewerHost'

const LEFT_MIN = 208
const LEFT_MAX = 420
const RIGHT_MIN = 288
const RIGHT_MAX = 620

interface WorkspaceStyle extends CSSProperties {
  '--left-panel-width': string
  '--right-panel-width': string
}

export interface WorkspaceProps {
  mountViewer?: ViewerMountFactory
}

function EditorSummary() {
  const { state } = useWorkspace()
  return (
    <section className="editor-summary" aria-labelledby="editor-heading">
      <p className="panel-kicker">Workspace</p>
      <h2 id="editor-heading">Editor</h2>
      <dl>
        <div><dt>Shader</dt><dd>{state.draft.name}</dd></div>
        <div><dt>Origin</dt><dd>{state.draft.origin === 'builtin' ? 'Built-in · read only' : 'Local'}</dd></div>
        <div><dt>Compile</dt><dd>{state.compile.status}</dd></div>
      </dl>
      <p className="panel-message">Source and parameter editing are available in the editor panel.</p>
    </section>
  )
}

export function Workspace({ mountViewer }: WorkspaceProps) {
  const [leftWidth, setLeftWidth] = useState(260)
  const [rightWidth, setRightWidth] = useState(420)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const style: WorkspaceStyle = {
    '--left-panel-width': `${leftCollapsed ? 0 : leftWidth}px`,
    '--right-panel-width': `${rightCollapsed ? 0 : rightWidth}px`,
  }

  return (
    <div className="workspace-shell" style={style}>
      <aside id="shader-library-panel" className="workspace-panel workspace-library" aria-label="Shader library panel" hidden={leftCollapsed}>
        <ErrorBoundary panelName="Library">
          <ModelLoader />
          <ShaderLibrary />
        </ErrorBoundary>
      </aside>
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

      <main className="workspace-viewer" aria-label="Shader workspace">
        <ErrorBoundary panelName="Viewer"><ViewerHost mountViewer={mountViewer} /></ErrorBoundary>
      </main>

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
      <aside id="shader-editor-panel" className="workspace-panel workspace-editor" aria-label="Shader editor panel" hidden={rightCollapsed}>
        <ErrorBoundary panelName="Editor"><EditorSummary /></ErrorBoundary>
      </aside>
    </div>
  )
}
