import { useState, type CSSProperties } from 'react'
import { ErrorBoundary } from './common/ErrorBoundary'
import { PanelResizer } from './common/PanelResizer'
import { ModelLoader } from './library/ModelLoader'
import { ShaderLibrary } from './library/ShaderLibrary'
import { ViewerHost, type ViewerMountFactory } from './viewer/ViewerHost'
import { ShaderEditorPanel, type ShaderSourceEditor } from './editor/ShaderEditorPanel'

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
  SourceEditor?: ShaderSourceEditor
}

export function Workspace({ mountViewer, SourceEditor }: WorkspaceProps) {
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
        <ErrorBoundary panelName="Editor"><ShaderEditorPanel SourceEditor={SourceEditor} /></ErrorBoundary>
      </aside>
    </div>
  )
}
