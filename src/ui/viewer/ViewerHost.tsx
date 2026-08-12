import { useEffect, useRef, useState } from 'react'
import { useWorkspace } from '../../application/WorkspaceController'
import { ViewerEngine } from '../../three/ViewerEngine'
import { ViewerToolbar } from './ViewerToolbar'

export interface ViewerMountHandle {
  dispose(): void
}

export type ViewerMountFactory = (host: HTMLElement) => ViewerMountHandle

const DEFAULT_MOUNT: ViewerMountFactory = (host) => new ViewerEngine(host)

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The 3D viewer could not be initialized.'
}

export interface ViewerHostProps {
  mountViewer?: ViewerMountFactory
}

export function ViewerHost({ mountViewer = DEFAULT_MOUNT }: ViewerHostProps) {
  const { state } = useWorkspace()
  const canvasHost = useRef<HTMLDivElement>(null)
  const [mountError, setMountError] = useState<string>()

  useEffect(() => {
    const host = canvasHost.current
    if (host === null) return
    let handle: ViewerMountHandle
    try {
      handle = mountViewer(host)
    } catch (error) {
      setMountError(errorMessage(error))
      return
    }
    return () => handle.dispose()
  }, [mountViewer])

  let overlay: React.ReactNode
  if (mountError !== undefined) {
    overlay = <div className="viewer-overlay viewer-error" role="alert"><strong>Viewer unavailable</strong><span>{mountError}</span></div>
  } else {
    switch (state.modelLoad.status) {
      case 'empty':
        overlay = <div className="viewer-overlay"><strong>No model loaded</strong><span>Load a GLB or GLTF from the library panel.</span></div>
        break
      case 'loading':
        overlay = <div className="viewer-overlay" role="status"><strong>Loading {state.modelLoad.fileName}…</strong><span>Resolving local dependencies</span></div>
        break
      case 'error':
        overlay = <div className="viewer-overlay viewer-error" role="alert"><strong>Model could not be loaded</strong><span>{state.modelLoad.message}</span></div>
        break
      case 'loaded':
        overlay = undefined
        break
    }
  }

  return (
    <section className="viewer-stage" aria-label="3D viewer">
      <ViewerToolbar />
      <div className="viewer-viewport">
        <div ref={canvasHost} className="viewer-canvas" data-testid="viewer-canvas" />
        {overlay}
      </div>
    </section>
  )
}
