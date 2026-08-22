import { act, cleanup, render, waitFor } from '@testing-library/react'
import {
  BoxGeometry,
  Group,
  Matrix3,
  Mesh,
  MeshBasicMaterial,
  Vector2,
  Vector3,
} from 'three'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShaderRepository } from './ShaderRepository'
import {
  WorkspaceProvider,
  useWorkspace,
  type WorkspaceContextValue,
} from './WorkspaceController'
import {
  ViewerEngine,
  type CompilerPort,
  type EnvironmentPort,
  type LoadedModel,
  type ModelLoaderPort,
  type ViewerControls,
  type ViewerRenderer,
} from '../three/ViewerEngine'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => { resolve = promiseResolve })
  return { promise, resolve }
}

function createRepository(): ShaderRepository {
  return {
    list: vi.fn(async () => []),
    get: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  }
}

function createViewer(loader: ModelLoaderPort, onModelName: (name: string) => void): ViewerEngine {
  const host = document.createElement('div')
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: 800 })
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: 400 })
  const canvas = document.createElement('canvas')
  const renderer: ViewerRenderer = {
    debug: { checkShaderErrors: true, onShaderError: null },
    domElement: canvas,
    dispose: vi.fn(),
    getDrawingBufferSize: vi.fn((target: Vector2) => target.set(canvas.width, canvas.height)),
    render: vi.fn(),
    setPixelRatio: vi.fn(),
    setSize: vi.fn((width: number, height: number) => {
      canvas.width = width
      canvas.height = height
    }),
  }
  const controls: ViewerControls = {
    target: new Vector3(),
    update: vi.fn(),
    saveState: vi.fn(),
    dispose: vi.fn(),
  }
  let compileGeneration = 0
  const compiler: CompilerPort = {
    material: undefined,
    compile: vi.fn(async () => ({ status: 'valid' as const, generation: ++compileGeneration })),
    updateParameter: vi.fn(),
    dispose: vi.fn(),
  }
  const environment: EnvironmentPort = {
    binding: {
      environmentMap: { value: null },
      environmentRotation: { value: new Matrix3() },
      environmentIntensity: { value: 1 },
    },
    load: vi.fn(async () => undefined),
    update: vi.fn(),
    dispose: vi.fn(),
  }
  return new ViewerEngine(host, { onModelInfo: ({ name }) => onModelName(name) }, {
    loader,
    createRenderer: () => renderer,
    createControls: () => controls,
    createCompiler: () => compiler,
    createEnvironment: () => environment,
    createResizeObserver: () => ({ observe: vi.fn(), disconnect: vi.fn() }),
    requestAnimationFrame: vi.fn(() => 1),
    cancelAnimationFrame: vi.fn(),
    devicePixelRatio: 1,
  })
}

afterEach(cleanup)

describe('WorkspaceProvider with ViewerEngine', () => {
  it('keeps the user model visible when a pending default parse resolves last', async () => {
    const defaultParse = deferred<LoadedModel>()
    const defaultGeometry = new BoxGeometry()
    const defaultRoot = new Group().add(new Mesh(defaultGeometry, new MeshBasicMaterial()))
    const userRoot = new Group().add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()))
    const disposeDefaultGeometry = vi.spyOn(defaultGeometry, 'dispose')
    const loader: ModelLoaderPort = {
      load: vi.fn((_files, root) => root.name === 'Fox.glb'
        ? defaultParse.promise
        : Promise.resolve({ scene: userRoot, animations: [] })),
    }
    const installedModelNames: string[] = []
    const viewer = createViewer(loader, (name) => installedModelNames.push(name))
    let workspace: WorkspaceContextValue | undefined
    function Probe(): ReactNode {
      workspace = useWorkspace()
      return null
    }
    const rendered = render(
      <WorkspaceProvider
        repository={createRepository()}
        viewer={viewer}
        defaultModel={{ url: '/assets/fox.glb', fileName: 'Fox.glb' }}
        defaultModelFetcher={vi.fn(async () => new Blob(['default']))}
      >
        <Probe />
      </WorkspaceProvider>,
    )
    await waitFor(() => expect(loader.load).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'Fox.glb' })],
      expect.objectContaining({ name: 'Fox.glb' }),
      expect.any(AbortSignal),
    ))
    if (workspace === undefined) throw new Error('Workspace did not render')
    const userFile = new File(['user'], 'user.glb', { type: 'model/gltf-binary' })

    await act(async () => workspace!.commands.loadModel([userFile], userFile))
    await act(async () => { defaultParse.resolve({ scene: defaultRoot, animations: [] }) })
    await waitFor(() => expect(
      disposeDefaultGeometry.mock.calls.length > 0 || installedModelNames.length > 1,
    ).toBe(true))

    expect(userRoot.parent).not.toBeNull()
    expect(defaultRoot.parent).toBeNull()
    expect(disposeDefaultGeometry).toHaveBeenCalledOnce()
    expect(installedModelNames).toEqual(['user.glb'])
    expect(workspace.state.modelLoad).toMatchObject({ status: 'loaded', name: 'user.glb' })

    rendered.unmount()
    viewer.dispose()
  })
})
