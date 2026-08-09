import { useEffect, useMemo } from 'react'
import { WorkspaceProvider } from './application/WorkspaceController'
import type { ShaderRepository } from './application/ShaderRepository'
import type { CompileResult, ModelInfo, ViewerPort } from './application/ViewerPort'
import type { ShaderParameterDefinition, ShaderParameterValue } from './domain/parameters'
import type { ShaderDraft, ShaderPortrait } from './domain/shader'
import { IndexedDbShaderRepository } from './persistence/IndexedDbShaderRepository'
import { ViewerEngine } from './three/ViewerEngine'
import { Workspace } from './ui/Workspace'
import type { ViewerMountFactory } from './ui/viewer/ViewerHost'

export type ViewerEngineFactory = (host: HTMLElement) => ViewerPort

export interface AppProps {
  repository?: ShaderRepository
  createViewer?: ViewerEngineFactory
}

const DEFAULT_VIEWER_FACTORY: ViewerEngineFactory = (host) => new ViewerEngine(host)
const DEFAULT_REPOSITORY = new IndexedDbShaderRepository()

class MountedViewerPort implements ViewerPort {
  private engine?: ViewerPort
  private readonly waiting: Array<(engine: ViewerPort) => void> = []

  attach(engine: ViewerPort): void {
    this.engine = engine
    for (const resolve of this.waiting.splice(0)) resolve(engine)
  }

  detach(engine: ViewerPort): void {
    if (this.engine === engine) this.engine = undefined
  }

  async loadModel(files: File[], root: File): Promise<ModelInfo> {
    return (await this.mounted()).loadModel(files, root)
  }

  fitModel(): void {
    this.engine?.fitModel()
  }

  resize(): void {
    this.engine?.resize()
  }

  async compileShader(draft: ShaderDraft): Promise<CompileResult> {
    return (await this.mounted()).compileShader(draft)
  }

  updateParameter(definition: ShaderParameterDefinition, value: ShaderParameterValue): void {
    this.engine?.updateParameter(definition, value)
  }

  async capturePortrait(): Promise<ShaderPortrait> {
    return (await this.mounted()).capturePortrait()
  }

  selectAnimation(name: string): void {
    this.engine?.selectAnimation(name)
  }

  setAnimationPlaying(playing: boolean): void {
    this.engine?.setAnimationPlaying(playing)
  }

  dispose(): void {
    const engine = this.engine
    if (engine === undefined) return
    this.engine = undefined
    engine.dispose()
  }

  private mounted(): Promise<ViewerPort> {
    if (this.engine !== undefined) return Promise.resolve(this.engine)
    return new Promise((resolve) => this.waiting.push(resolve))
  }
}

function createViewerRuntime(createViewer: ViewerEngineFactory): {
  viewer: ViewerPort
  mountViewer: ViewerMountFactory
} {
  const viewer = new MountedViewerPort()
  return {
    viewer,
    mountViewer(host) {
      const engine = createViewer(host)
      viewer.attach(engine)
      let active = true
      return {
        dispose() {
          if (!active) return
          active = false
          viewer.detach(engine)
          engine.dispose()
        },
      }
    },
  }
}

function App({ repository: injectedRepository, createViewer = DEFAULT_VIEWER_FACTORY }: AppProps) {
  const repository = injectedRepository ?? DEFAULT_REPOSITORY
  const runtime = useMemo(() => createViewerRuntime(createViewer), [createViewer])

  useEffect(() => {
    if (injectedRepository !== undefined) return
    return () => (repository as IndexedDbShaderRepository).close()
  }, [injectedRepository, repository])

  return (
    <WorkspaceProvider repository={repository} viewer={runtime.viewer}>
      <Workspace mountViewer={runtime.mountViewer} />
    </WorkspaceProvider>
  )
}

export default App
