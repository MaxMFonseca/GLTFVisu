import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CompileResult, ModelInfo } from '../application/ViewerPort'
import { BUILTIN_SHADERS } from '../domain/builtins'
import type { EnvironmentDisplaySettings, EnvironmentLoadSource } from '../domain/environment'
import type { ShaderDraft } from '../domain/shader'
import { renderBuiltinPortrait } from './renderBuiltinPortrait'

const { viewerEngineConstructor } = vi.hoisted(() => ({
  viewerEngineConstructor: vi.fn(),
}))

vi.mock('../three/ViewerEngine', () => ({
  ViewerEngine: viewerEngineConstructor,
}))

type PortraitState =
  | { status: 'loading'; shaderId: string }
  | { status: 'ready'; shaderId: string }
  | { status: 'error'; shaderId: string; message: string }

interface FakeViewer {
  loadModel(files: File[], root: File): Promise<ModelInfo>
  loadEnvironment(source: EnvironmentLoadSource): Promise<void>
  updateEnvironment(settings: EnvironmentDisplaySettings): void
  compileShader(draft: ShaderDraft): Promise<CompileResult>
  setPortraitView(): void
  dispose(): void
}

const portraitWindow = window as Window & { __GLTFVISU_PORTRAIT__?: PortraitState }

afterEach(() => {
  delete portraitWindow.__GLTFVISU_PORTRAIT__
  viewerEngineConstructor.mockReset()
})

function successfulViewer(order: string[]): FakeViewer {
  return {
    loadModel: vi.fn(async () => {
      order.push('load-model')
      return { name: 'suzanne.glb', meshCount: 1, animationClips: [], textureSlots: [] }
    }),
    loadEnvironment: vi.fn(async () => { order.push('load-environment') }),
    updateEnvironment: vi.fn(() => { order.push('update-environment') }),
    compileShader: vi.fn(async (): Promise<CompileResult> => {
      order.push('compile-shader')
      return { status: 'valid', generation: 1 }
    }),
    setPortraitView: vi.fn(() => { order.push('set-portrait-view') }),
    dispose: vi.fn(),
  }
}

function successfulFetch(): Promise<Response> {
  return Promise.resolve(new Response(new Blob(['glb']), { status: 200 }))
}

describe('renderBuiltinPortrait', () => {
  it('constructs the production viewer at device scale factor one', async () => {
    const viewer = successfulViewer([])
    viewerEngineConstructor.mockReturnValueOnce(viewer)
    const host = document.createElement('div')

    await renderBuiltinPortrait(host, 'builtin-pbr', {
      fetch: successfulFetch,
      waitForAnimationFrame: async () => undefined,
    })

    expect(viewerEngineConstructor).toHaveBeenCalledWith(host, {}, { devicePixelRatio: 1 })
    window.dispatchEvent(new Event('pagehide'))
  })

  it('marks ready only after the deterministic model, environment, shader, view, and frame sequence', async () => {
    const order: string[] = []
    let state: PortraitState | undefined
    Object.defineProperty(portraitWindow, '__GLTFVISU_PORTRAIT__', {
      configurable: true,
      get: () => state,
      set: (next: PortraitState) => {
        state = next
        if (next.status === 'ready') order.push('ready')
      },
    })
    const viewer = successfulViewer(order)
    const host = document.createElement('div')
    const selected = BUILTIN_SHADERS.find(({ id }) => id === 'builtin-pbr')!

    await renderBuiltinPortrait(host, selected.id, {
      fetch: vi.fn(successfulFetch),
      createViewer: vi.fn(() => viewer),
      waitForAnimationFrame: vi.fn(async () => { order.push('frame') }),
    })

    expect(order).toEqual([
      'load-model',
      'load-environment',
      'update-environment',
      'compile-shader',
      'set-portrait-view',
      'frame',
      'frame',
      'ready',
    ])
    expect(state).toEqual({ status: 'ready', shaderId: selected.id })
    expect(viewer.loadModel).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'suzanne.glb', type: 'model/gltf-binary' })],
      expect.objectContaining({ name: 'suzanne.glb', type: 'model/gltf-binary' }),
    )
    expect(viewer.loadEnvironment).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'bundled',
      id: 'poly-haven-studio',
      url: expect.stringContaining('poly-haven-studio-1k.hdr'),
    }))
    expect(viewer.updateEnvironment).toHaveBeenCalledWith({
      backgroundMode: 'clear-color',
      clearColor: '#77797d',
      rotation: 0,
      intensity: 1,
      blur: 0,
    })
    const compiled = vi.mocked(viewer.compileShader).mock.calls[0][0]
    expect(compiled).not.toBe(selected)
    expect(compiled.parameters).not.toBe(selected.parameters)
    expect(compiled.parameterValues).not.toBe(selected.parameterValues)
    expect(compiled).toEqual(selected)
    expect(viewer.dispose).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('pagehide'))
    expect(viewer.dispose).toHaveBeenCalledOnce()
  })

  it.each([
    {
      label: 'model fetch',
      message: 'fetch failed',
      alter: () => ({ fetch: vi.fn(async () => { throw new Error('fetch failed') }) }),
    },
    {
      label: 'model load',
      message: 'model failed',
      alter: (viewer: FakeViewer) => {
        vi.mocked(viewer.loadModel).mockRejectedValueOnce(new Error('model failed'))
        return {}
      },
    },
    {
      label: 'environment load',
      message: 'environment failed',
      alter: (viewer: FakeViewer) => {
        vi.mocked(viewer.loadEnvironment).mockRejectedValueOnce(new Error('environment failed'))
        return {}
      },
    },
    {
      label: 'shader compile',
      message: 'shader failed',
      alter: (viewer: FakeViewer) => {
        vi.mocked(viewer.compileShader).mockResolvedValueOnce({
          status: 'error',
          generation: 1,
          diagnostics: [{ severity: 'error', message: 'shader failed', raw: 'shader failed' }],
        })
        return {}
      },
    },
  ])('records an explicit error state after a $label failure', async ({ message, alter }) => {
    const viewer = successfulViewer([])
    const overrides = alter(viewer)

    await renderBuiltinPortrait(document.createElement('div'), 'builtin-pbr', {
      fetch: successfulFetch,
      createViewer: () => viewer,
      waitForAnimationFrame: async () => undefined,
      ...overrides,
    })

    expect(portraitWindow.__GLTFVISU_PORTRAIT__).toEqual({
      status: 'error',
      shaderId: 'builtin-pbr',
      message,
    })
    expect(viewer.setPortraitView).not.toHaveBeenCalled()
    expect(viewer.dispose).toHaveBeenCalledTimes(message === 'fetch failed' ? 0 : 1)
  })
})
