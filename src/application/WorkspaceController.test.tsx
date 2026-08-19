import { act, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_SHADERS } from '../domain/builtins'
import { validateRemoteEnvironmentUrl, type EnvironmentDefinition } from '../domain/environment'
import type { ShaderParameterDefinition } from '../domain/parameters'
import type { ShaderDefinition, ShaderPortrait } from '../domain/shader'
import type { ShaderRepository } from './ShaderRepository'
import type { CompileResult, ModelInfo, ViewerPort } from './ViewerPort'
import {
  WorkspaceProvider,
  useWorkspace,
  type WorkspaceContextValue,
  type WorkspaceProviderProps,
} from './WorkspaceController'

function localShader(overrides: Partial<ShaderDefinition> = {}): ShaderDefinition {
  return {
    id: 'local-one',
    name: 'Local shader',
    fragmentSource: 'void main() { outColor = vec4(uGain); }',
    origin: 'local',
    parameters: [
      { id: 'gain', type: 'float', uniformName: 'uGain', label: 'Gain', min: 0, max: 2, step: 0.1, defaultValue: 1 },
    ],
    parameterValues: { gain: 1 },
    createdAt: 10,
    updatedAt: 10,
    schemaVersion: 2,
    materialInputProfile: 'none',
    ...overrides,
  }
}

function createRepository(locals: ShaderDefinition[] = []): ShaderRepository {
  return {
    list: vi.fn(async () => locals),
    get: vi.fn(async (id) => locals.find((shader) => shader.id === id)),
    save: vi.fn(async (shader) => { locals.splice(0, locals.length, shader) }),
    delete: vi.fn(async (id) => { locals.splice(0, locals.length, ...locals.filter((shader) => shader.id !== id)) }),
  }
}

function createViewer(): ViewerPort {
  let generation = 0
  return {
    loadModel: vi.fn(async (): Promise<ModelInfo> => ({
      name: 'model.glb',
      meshCount: 2,
      animationClips: [{ id: 'clip-0', label: 'Idle' }, { id: 'clip-1', label: 'Run' }],
      textureSlots: [],
    })),
    replaceModelTexture: vi.fn(async () => []),
    restoreModelTexture: vi.fn(async () => []),
    fitModel: vi.fn(),
    resize: vi.fn(),
    compileShader: vi.fn(async (): Promise<CompileResult> => ({ status: 'valid', generation: ++generation })),
    updateParameter: vi.fn(),
    loadEnvironment: vi.fn(async () => undefined),
    updateEnvironment: vi.fn(),
    capturePortrait: vi.fn(async (): Promise<ShaderPortrait> => ({
      kind: 'captured', blob: new Blob(['portrait']), mimeType: 'image/png', width: 4, height: 4,
    })),
    selectAnimation: vi.fn(),
    setAnimationPlaying: vi.fn(),
    dispose: vi.fn(),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(blob)
  })
}

function renderWorkspace(overrides: Partial<WorkspaceProviderProps> = {}) {
  const repository = overrides.repository ?? createRepository()
  const viewer = overrides.viewer ?? createViewer()
  let latest: WorkspaceContextValue | undefined
  function Probe(): ReactNode {
    latest = useWorkspace()
    return null
  }
  const rendered = render(
    <WorkspaceProvider repository={repository} viewer={viewer} {...overrides}>
      <Probe />
    </WorkspaceProvider>,
  )
  return {
    ...rendered,
    repository,
    viewer,
    current: () => {
      if (latest === undefined) throw new Error('Workspace did not render')
      return latest
    },
  }
}

async function ready(workspace: ReturnType<typeof renderWorkspace>): Promise<void> {
  await waitFor(() => expect(workspace.current().state.hydration).toBe('ready'))
  await waitFor(() => expect(workspace.current().state.compile.status).toBe('valid'))
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('WorkspaceProvider', () => {
  it('validates remote HDR URLs and loads valid sources through the viewer', async () => {
    expect(validateRemoteEnvironmentUrl('http://example.com/a.hdr')).toEqual({
      valid: false,
      message: 'Environment URL must use HTTPS',
    })
    expect(validateRemoteEnvironmentUrl('https://example.com/a.hdr')).toEqual({ valid: true })

    const viewer = createViewer()
    const workspace = renderWorkspace({ viewer })
    await ready(workspace)

    await act(async () => workspace.current().commands.loadRemoteEnvironment('https://example.com/city.hdr'))

    expect(viewer.loadEnvironment).toHaveBeenCalledWith({ kind: 'remote', url: 'https://example.com/city.hdr' })
    expect(workspace.current().state.environment.status).toBe('ready')
  })

  it('uses the injected catalog for bundled environments and rejects mismatched URLs', async () => {
    const catalog: readonly EnvironmentDefinition[] = [{
      id: 'studio', name: 'Studio', hdrUrl: '/assets/studio.hdr', license: 'CC0-1.0',
      sourceUrl: 'https://example.com/studio', author: 'Example',
    }]
    const viewer = createViewer()
    const workspace = renderWorkspace({ viewer, environmentCatalog: catalog })
    await ready(workspace)

    await act(async () => workspace.current().commands.selectBundledEnvironment('studio', '/assets/studio.hdr'))
    await act(async () => workspace.current().commands.selectBundledEnvironment('studio', '/assets/other.hdr'))

    expect(viewer.loadEnvironment).toHaveBeenCalledTimes(1)
    expect(viewer.loadEnvironment).toHaveBeenCalledWith({ kind: 'bundled', id: 'studio', url: '/assets/studio.hdr' })
    expect(workspace.current().state.notices.at(-1)).toEqual({
      kind: 'error', scope: 'environment', message: 'Bundled environment URL does not match the catalog',
    })
  })

  it('does not let a stale environment result replace the newest active source', async () => {
    const viewer = createViewer()
    const first = deferred<void>()
    const second = deferred<void>()
    vi.mocked(viewer.loadEnvironment).mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
    const workspace = renderWorkspace({ viewer })
    await ready(workspace)

    let firstLoad!: Promise<void>
    let secondLoad!: Promise<void>
    act(() => { firstLoad = workspace.current().commands.loadRemoteEnvironment('https://example.com/first.hdr') })
    act(() => { secondLoad = workspace.current().commands.loadRemoteEnvironment('https://example.com/second.hdr') })
    await act(async () => { second.resolve(); await secondLoad })
    await act(async () => { first.resolve(); await firstLoad })

    expect(workspace.current().state.environment).toMatchObject({
      status: 'ready', activeSource: { kind: 'remote', url: 'https://example.com/second.hdr' },
    })
  })

  it('keeps the active environment settings when a replacement load fails', async () => {
    const viewer = createViewer()
    const workspace = renderWorkspace({ viewer })
    await ready(workspace)
    await act(async () => workspace.current().commands.loadRemoteEnvironment('https://example.com/active.hdr'))
    act(() => workspace.current().commands.setEnvironmentIntensity(2))
    vi.mocked(viewer.loadEnvironment).mockRejectedValueOnce(new Error('decoder detail'))

    await act(async () => workspace.current().commands.loadRemoteEnvironment('https://example.com/broken.hdr'))

    expect(workspace.current().state.environment).toEqual({
      status: 'error',
      activeSource: { kind: 'remote', url: 'https://example.com/active.hdr' },
      error: 'Unable to load environment',
      settings: { backgroundMode: 'skybox', clearColor: '#17191d', rotation: 0, intensity: 2 },
    })
    expect(workspace.current().state.notices.at(-1)).toEqual({
      kind: 'error', scope: 'environment', message: 'Unable to load environment',
    })
  })

  it('normalizes display settings and forwards each update without persisting it', async () => {
    const viewer = createViewer()
    const workspace = renderWorkspace({ viewer })
    await ready(workspace)

    act(() => workspace.current().commands.setEnvironmentClearColor('#ABCDEF'))
    act(() => workspace.current().commands.setEnvironmentRotation(-90))
    act(() => workspace.current().commands.setEnvironmentIntensity(8))

    expect(workspace.current().state.environment.settings).toEqual({
      backgroundMode: 'skybox', clearColor: '#abcdef', rotation: 270, intensity: 4,
    })
    expect(viewer.updateEnvironment).toHaveBeenLastCalledWith({
      backgroundMode: 'skybox', clearColor: '#abcdef', rotation: 270, intensity: 4,
    })
    expect(workspace.current().state.dirty).toEqual({ name: false, source: false, schema: false, values: false, portrait: false })
  })

  it('composes environment settings commands issued in one batched turn', async () => {
    const viewer = createViewer()
    const workspace = renderWorkspace({ viewer })
    await ready(workspace)

    act(() => {
      workspace.current().commands.setEnvironmentRotation(90)
      workspace.current().commands.setEnvironmentIntensity(2)
      workspace.current().commands.setEnvironmentClearColor('#ABCDEF')
    })

    const expected = { backgroundMode: 'skybox' as const, clearColor: '#abcdef', rotation: 90, intensity: 2 }
    expect(workspace.current().state.environment.settings).toEqual(expected)
    expect(viewer.updateEnvironment).toHaveBeenLastCalledWith(expected)
  })
  it('shows the initial built-in, hydrates locals, and compiles without persisting', async () => {
    const repository = createRepository([localShader()])
    const viewer = createViewer()
    const workspace = renderWorkspace({ repository, viewer })

    expect(workspace.current().state.selectedId).toBe(BUILTIN_SHADERS[0].id)
    await ready(workspace)

    expect(workspace.current().state.locals).toEqual([localShader()])
    expect(viewer.compileShader).toHaveBeenCalledWith(expect.objectContaining({ id: BUILTIN_SHADERS[0].id }))
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('debounces source compilation for exactly 400 ms and cancels it on selection and unmount', async () => {
    vi.useFakeTimers()
    const local = localShader()
    const repository = createRepository([local])
    const viewer = createViewer()
    const workspace = renderWorkspace({ repository, viewer })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await act(async () => { workspace.current().commands.selectShader(local.id); await Promise.resolve() })
    vi.mocked(viewer.compileShader).mockClear()

    act(() => workspace.current().commands.editSource('first edit'))
    act(() => workspace.current().commands.updateValue('gain', 1.8))
    act(() => vi.advanceTimersByTime(399))
    expect(viewer.compileShader).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(viewer.compileShader).toHaveBeenCalledTimes(1)
    expect(viewer.compileShader).toHaveBeenLastCalledWith(expect.objectContaining({
      fragmentSource: 'first edit', parameterValues: { gain: 1.8 },
    }))

    act(() => workspace.current().commands.editSource('cancelled by select'))
    act(() => workspace.current().commands.selectShader(BUILTIN_SHADERS[1].id))
    vi.mocked(viewer.compileShader).mockClear()
    act(() => vi.advanceTimersByTime(400))
    expect(viewer.compileShader).not.toHaveBeenCalled()

    act(() => workspace.current().commands.selectShader(local.id))
    vi.mocked(viewer.compileShader).mockClear()
    act(() => workspace.current().commands.editSource('cancelled by unmount'))
    workspace.unmount()
    act(() => vi.advanceTimersByTime(400))
    expect(viewer.compileShader).not.toHaveBeenCalled()
  })

  it('ignores stale compile responses in application state', async () => {
    const viewer = createViewer()
    const workspace = renderWorkspace({ viewer })
    await ready(workspace)
    const first = deferred<CompileResult>()
    const second = deferred<CompileResult>()
    vi.mocked(viewer.compileShader)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)

    act(() => { void workspace.current().commands.compile() })
    act(() => { void workspace.current().commands.compile() })
    await act(async () => second.resolve({ status: 'valid', generation: 22 }))
    await act(async () => first.resolve({
      status: 'error', generation: 21, diagnostics: [{ severity: 'error', message: 'stale error', raw: 'stale' }],
    }))

    expect(workspace.current().state.compile).toMatchObject({ status: 'valid', diagnostics: [] })
  })

  it('updates runtime values synchronously without compiling and saves only on explicit Save', async () => {
    const local = localShader()
    const repository = createRepository([local])
    const viewer = createViewer()
    const workspace = renderWorkspace({ repository, viewer, now: () => 50 })
    await ready(workspace)
    await act(async () => workspace.current().commands.selectShader(local.id))
    vi.mocked(viewer.compileShader).mockClear()

    act(() => workspace.current().commands.updateValue('gain', 9))

    expect(viewer.updateParameter).toHaveBeenCalledWith(local.parameters[0], 2)
    expect(viewer.compileShader).not.toHaveBeenCalled()
    expect(workspace.current().state.draft.parameterValues.gain).toBe(2)
    expect(workspace.current().state.dirty.values).toBe(true)
    expect(repository.save).not.toHaveBeenCalled()

    await act(async () => workspace.current().commands.save())
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ id: local.id, parameterValues: { gain: 2 }, updatedAt: 50 }))
    expect(workspace.current().state.dirty.values).toBe(false)
    expect(workspace.current().state.notices.at(-1)).toEqual({ kind: 'info', scope: 'save', message: 'Saved Local shader' })
  })

  it('updates built-in runtime values without compiling or saving and duplicates their session values', async () => {
    const builtinFresnel = BUILTIN_SHADERS.find((shader) => shader.id === 'builtin-fresnel')
    if (builtinFresnel === undefined) throw new Error('Expected Fresnel built-in')
    const fresnel = { ...builtinFresnel, materialInputProfile: 'gltf-surface' as const }
    const repository = createRepository()
    const viewer = createViewer()
    const workspace = renderWorkspace({
      repository,
      viewer,
      builtins: [fresnel, ...BUILTIN_SHADERS.filter((shader) => shader.id !== fresnel.id)],
      idFactory: () => 'fresnel-copy',
      now: () => 50,
    })
    await ready(workspace)
    await act(async () => workspace.current().commands.selectShader(fresnel.id))
    vi.mocked(viewer.compileShader).mockClear()

    act(() => workspace.current().commands.updateValue('power', 6))

    expect(viewer.updateParameter).toHaveBeenCalledWith(fresnel.parameters[0], 6)
    expect(viewer.compileShader).not.toHaveBeenCalled()
    expect(repository.save).not.toHaveBeenCalled()
    expect(workspace.current().state.draft.parameterValues.power).toBe(6)
    expect(workspace.current().state.dirty.values).toBe(false)

    await act(async () => workspace.current().commands.duplicateShader())

    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({
      id: 'fresnel-copy', origin: 'local', materialInputProfile: fresnel.materialInputProfile,
      parameterValues: expect.objectContaining({ power: 6 }),
    }))
  })

  it('recompiles a reselected built-in with its restored session values', async () => {
    const fresnel = BUILTIN_SHADERS.find((shader) => shader.id === 'builtin-fresnel')
    const toon = BUILTIN_SHADERS.find((shader) => shader.id === 'builtin-toon')
    if (fresnel === undefined || toon === undefined) throw new Error('Expected Fresnel and Toon built-ins')
    const viewer = createViewer()
    const workspace = renderWorkspace({ viewer })
    await ready(workspace)
    await act(async () => workspace.current().commands.selectShader(fresnel.id))
    act(() => workspace.current().commands.updateValue('power', 6))
    vi.mocked(viewer.compileShader).mockClear()

    await act(async () => workspace.current().commands.selectShader(toon.id))
    await act(async () => workspace.current().commands.selectShader(fresnel.id))

    expect(viewer.compileShader).toHaveBeenLastCalledWith(expect.objectContaining({
      id: fresnel.id,
      parameterValues: expect.objectContaining({ power: 6 }),
    }))
  })

  it('blocks invalid schemas from compile and save while preserving a recoverable draft', async () => {
    const local = localShader()
    const repository = createRepository([local])
    const viewer = createViewer()
    const workspace = renderWorkspace({ repository, viewer })
    await ready(workspace)
    await act(async () => workspace.current().commands.selectShader(local.id))
    vi.mocked(viewer.compileShader).mockClear()
    const invalid: ShaderParameterDefinition[] = [
      { id: 'bad', type: 'float', uniformName: 'not valid', label: 'Bad', min: 0, max: 1, step: 0.1, defaultValue: 0 },
    ]

    act(() => workspace.current().commands.editSchema(invalid, { bad: 0 }))
    await act(async () => workspace.current().commands.save())

    expect(workspace.current().state.compile.status).toBe('schema-invalid')
    expect(workspace.current().state.schemaErrors).not.toHaveLength(0)
    expect(workspace.current().state.dirty.schema).toBe(true)
    expect(viewer.compileShader).not.toHaveBeenCalled()
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('defensively blocks save while a dirty draft is uncompiled, compiling, or failed', async () => {
    const local = localShader()
    const repository = createRepository([local])
    const viewer = createViewer()
    const workspace = renderWorkspace({ repository, viewer })
    await ready(workspace)
    await act(async () => workspace.current().commands.selectShader(local.id))
    vi.mocked(repository.save).mockClear()
    vi.useFakeTimers()

    act(() => workspace.current().commands.editSource('uncompiled source'))
    expect(workspace.current().state.compile.status).toBe('idle')
    await act(async () => workspace.current().commands.save())
    expect(repository.save).not.toHaveBeenCalled()

    const pendingCompile = deferred<CompileResult>()
    vi.mocked(viewer.compileShader).mockReturnValueOnce(pendingCompile.promise)
    act(() => { void workspace.current().commands.compile() })
    expect(workspace.current().state.compile.status).toBe('pending')
    await act(async () => workspace.current().commands.save())
    expect(repository.save).not.toHaveBeenCalled()

    await act(async () => pendingCompile.resolve({
      status: 'error',
      generation: 2,
      diagnostics: [{ severity: 'error', message: 'Compile failed', raw: 'Compile failed' }],
    }))
    expect(workspace.current().state.compile.status).toBe('error')
    await act(async () => workspace.current().commands.save())
    expect(repository.save).not.toHaveBeenCalled()

    await act(async () => workspace.current().commands.compile())
    expect(workspace.current().state.compile.status).toBe('valid')
    await act(async () => workspace.current().commands.save())
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ fragmentSource: 'uncompiled source' }))
  })

  it('keeps a normalized dirty draft when Save fails', async () => {
    const local = localShader()
    const repository = createRepository([local])
    vi.mocked(repository.save).mockRejectedValue(new Error('Quota exceeded'))
    const workspace = renderWorkspace({ repository })
    await ready(workspace)
    await act(async () => workspace.current().commands.selectShader(local.id))
    act(() => workspace.current().commands.editName('  Changed locally  '))

    await act(async () => workspace.current().commands.save())

    expect(workspace.current().state.draft.name).toBe('  Changed locally  ')
    expect(workspace.current().state.savedSnapshot.name).toBe('Local shader')
    expect(workspace.current().state.dirty.name).toBe(true)
    expect(workspace.current().state.notices.at(-1)).toMatchObject({ scope: 'save', message: 'Quota exceeded' })
  })

  it('preserves newer edits when an earlier Save completes', async () => {
    const local = localShader()
    const repository = createRepository([local])
    const saveGate = deferred<void>()
    vi.mocked(repository.save).mockImplementationOnce(() => saveGate.promise)
    const workspace = renderWorkspace({ repository, now: () => 50 })
    await ready(workspace)
    await act(async () => workspace.current().commands.selectShader(local.id))
    act(() => workspace.current().commands.editName('  Saved name  '))

    let savePromise!: Promise<void>
    act(() => { savePromise = workspace.current().commands.save() })
    act(() => workspace.current().commands.editSource('newer source'))
    await act(async () => { saveGate.resolve(); await savePromise })

    expect(workspace.current().state.savedSnapshot).toMatchObject({ name: 'Saved name', updatedAt: 50 })
    expect(workspace.current().state.draft).toMatchObject({ name: 'Saved name', fragmentSource: 'newer source' })
    expect(workspace.current().state.dirty).toMatchObject({ name: false, source: true })
  })

  it('keeps a post-submit value round trip dirty until another explicit Save', async () => {
    const local = localShader()
    const repository = createRepository([local])
    const saveGate = deferred<void>()
    vi.mocked(repository.save).mockImplementationOnce(() => saveGate.promise)
    const workspace = renderWorkspace({ repository, now: () => 50 })
    await ready(workspace)
    await act(async () => workspace.current().commands.selectShader(local.id))
    act(() => workspace.current().commands.editName('Saved name'))

    let savePromise!: Promise<void>
    act(() => { savePromise = workspace.current().commands.save() })
    act(() => workspace.current().commands.updateValue('gain', 2))
    act(() => workspace.current().commands.updateValue('gain', 1))
    await act(async () => { saveGate.resolve(); await savePromise })

    expect(workspace.current().state.dirty.name).toBe(false)
    expect(workspace.current().state.dirty.values).toBe(true)
    await act(async () => workspace.current().commands.save())
    expect(workspace.current().state.dirty.values).toBe(false)
  })

  it('merges a Save into the current baseline after selecting away and back to the same shader', async () => {
    const first = localShader({ id: 'first', name: 'First' })
    const second = localShader({ id: 'second', name: 'Second' })
    const repository = createRepository([first, second])
    const saveGate = deferred<void>()
    vi.mocked(repository.save).mockImplementationOnce(() => saveGate.promise)
    const workspace = renderWorkspace({ repository, now: () => 50 })
    await ready(workspace)
    await act(async () => workspace.current().commands.selectShader(first.id))
    act(() => workspace.current().commands.editName('  Persisted name  '))

    let firstSave!: Promise<void>
    act(() => { firstSave = workspace.current().commands.save() })
    await act(async () => workspace.current().commands.selectShader(second.id))
    await act(async () => workspace.current().commands.selectShader(first.id))
    act(() => workspace.current().commands.editSource('reselected source'))
    await act(async () => { saveGate.resolve(); await firstSave })

    expect(workspace.current().state.savedSnapshot).toMatchObject({ name: 'Persisted name', updatedAt: 50 })
    expect(workspace.current().state.draft).toMatchObject({ name: 'Persisted name', fragmentSource: 'reselected source' })
    expect(workspace.current().state.dirty).toMatchObject({ name: false, source: true })

    await act(async () => workspace.current().commands.compile())
    await act(async () => workspace.current().commands.save())
    expect(repository.save).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'first', name: 'Persisted name', fragmentSource: 'reselected source',
    }))
    expect(workspace.current().state.dirty.source).toBe(false)
  })

  it('blocks capture until a source adopted after reselection recompiles', async () => {
    const first = localShader({ id: 'first', name: 'First' })
    const second = localShader({ id: 'second', name: 'Second' })
    const repository = createRepository([first, second])
    const viewer = createViewer()
    const saveGate = deferred<void>()
    vi.mocked(repository.save).mockImplementationOnce(() => saveGate.promise)
    const workspace = renderWorkspace({ repository, viewer })
    await ready(workspace)
    await act(async () => workspace.current().commands.selectShader(first.id))
    const root = new File(['model'], 'model.glb')
    await act(async () => workspace.current().commands.loadModel([root], root))
    vi.useFakeTimers()

    act(() => workspace.current().commands.editSource('persisted source'))
    await act(async () => workspace.current().commands.compile())
    let savePromise!: Promise<void>
    act(() => { savePromise = workspace.current().commands.save() })
    await act(async () => workspace.current().commands.selectShader(second.id))
    await act(async () => workspace.current().commands.selectShader(first.id))
    vi.mocked(viewer.compileShader).mockClear()
    vi.mocked(viewer.capturePortrait).mockClear()

    await act(async () => { saveGate.resolve(); await savePromise })

    expect(workspace.current().state.draft.fragmentSource).toBe('persisted source')
    expect(workspace.current().state.compile.status).toBe('idle')
    await act(async () => workspace.current().commands.capturePortrait())
    expect(viewer.capturePortrait).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(399))
    expect(viewer.compileShader).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(viewer.compileShader).toHaveBeenCalledWith(expect.objectContaining({
      id: first.id,
      fragmentSource: 'persisted source',
    }))
    expect(workspace.current().state.compile.status).toBe('valid')

    await act(async () => workspace.current().commands.capturePortrait())
    expect(viewer.capturePortrait).toHaveBeenCalledTimes(1)
  })

  it('normalizes dirty reselected values against an adopted saved schema', async () => {
    const legacy = {
      id: 'legacy', type: 'boolean', uniformName: 'uLegacy', label: 'Legacy', defaultValue: false,
    } as const
    const first = localShader({
      id: 'first',
      name: 'First',
      parameters: [...localShader().parameters, legacy],
      parameterValues: { gain: 1, legacy: true },
    })
    const second = localShader({ id: 'second', name: 'Second' })
    const repository = createRepository([first, second])
    const saveGate = deferred<void>()
    vi.mocked(repository.save).mockImplementationOnce(() => saveGate.promise)
    const workspace = renderWorkspace({ repository })
    await ready(workspace)
    await act(async () => workspace.current().commands.selectShader(first.id))
    const savedParameters: ShaderParameterDefinition[] = [
      { id: 'gain', type: 'float', uniformName: 'uGain', label: 'Gain', min: 0, max: 1, step: 0.1, defaultValue: 0.25 },
      { id: 'tint', type: 'color', uniformName: 'uTint', label: 'Tint', defaultValue: '#112233' },
    ]
    act(() => workspace.current().commands.editSchema(savedParameters, { gain: 0.5, tint: '#abcdef' }))
    await act(async () => workspace.current().commands.compile())

    let savePromise!: Promise<void>
    act(() => { savePromise = workspace.current().commands.save() })
    await act(async () => workspace.current().commands.selectShader(second.id))
    await act(async () => workspace.current().commands.selectShader(first.id))
    act(() => workspace.current().commands.updateValue('gain', 1.8))
    await act(async () => { saveGate.resolve(); await savePromise })

    expect(workspace.current().state.draft.parameters).toEqual(savedParameters)
    expect(workspace.current().state.draft.parameterValues).toEqual({ gain: 1, tint: '#abcdef' })
    expect(workspace.current().state.dirty).toMatchObject({ schema: false, values: true })
    expect(workspace.current().state.compile.status).toBe('idle')

    await act(async () => workspace.current().commands.compile())
    await act(async () => workspace.current().commands.save())
    expect(repository.save).toHaveBeenLastCalledWith(expect.objectContaining({
      id: first.id,
      parameters: savedParameters,
      parameterValues: { gain: 1, tint: '#abcdef' },
    }))
    expect(workspace.current().state.dirty.values).toBe(false)
  })

  it('merges shaders created while repository hydration is pending', async () => {
    const hydration = deferred<ShaderDefinition[]>()
    const repository = createRepository()
    vi.mocked(repository.list).mockReturnValueOnce(hydration.promise)
    const workspace = renderWorkspace({ repository, idFactory: () => 'created' })

    await act(async () => workspace.current().commands.createShader())
    await act(async () => hydration.resolve([localShader({ id: 'stored' })]))

    expect(workspace.current().state.hydration).toBe('ready')
    expect(workspace.current().state.locals.map((shader) => shader.id)).toEqual(['created', 'stored'])
  })

  it('keeps built-ins read-only and gives duplicates fresh persisted identity and timestamps', async () => {
    const repository = createRepository()
    const workspace = renderWorkspace({ repository, idFactory: () => 'fresh-id', now: () => 100 })
    await ready(workspace)

    act(() => workspace.current().commands.editName('Blocked'))
    await act(async () => workspace.current().commands.duplicateShader())

    expect(workspace.current().state.builtins[0].name).toBe('Normal')
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({
      id: 'fresh-id', origin: 'local', name: 'Normal copy', createdAt: 100, updatedAt: 100,
    }))
    expect(workspace.current().state.draft.portrait).toBeUndefined()
    expect(workspace.current().state.selectedId).toBe('fresh-id')
  })

  it('imports strictly, exports a versioned Blob, and always revokes its URL', async () => {
    const repository = createRepository()
    const urls = { createObjectURL: vi.fn((blob: Blob) => { void blob; return 'blob:shader' }), revokeObjectURL: vi.fn() }
    const download = vi.fn()
    const workspace = renderWorkspace({ repository, urls, download, idFactory: () => 'import-id', now: () => 75 })
    await ready(workspace)
    const packageJson = JSON.stringify({
      format: 'gltf-shader-visualizer', version: 1,
      shader: { name: 'Imported', fragmentSource: 'void main() {}', parameters: [], parameterValues: {} },
    })

    await act(async () => workspace.current().commands.importShader(packageJson))
    await act(async () => workspace.current().commands.exportShader())

    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'import-id', origin: 'local', createdAt: 75 }))
    const blob = urls.createObjectURL.mock.calls[0][0]
    expect(JSON.parse(await readBlob(blob))).toMatchObject({ format: 'gltf-shader-visualizer', version: 2 })
    expect(download).toHaveBeenCalledWith('blob:shader', 'Imported.shader.json')
    expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:shader')
    expect(workspace.current().state.notices.at(-1)).toEqual({ kind: 'info', scope: 'export', message: 'Exported Imported' })

    await act(async () => workspace.current().commands.importShader('{bad json'))
    expect(vi.mocked(repository.save)).toHaveBeenCalledTimes(1)
    expect(workspace.current().state.notices.at(-1)).toMatchObject({ scope: 'import', message: 'Malformed shader JSON' })
  })

  it('requires a loaded model for capture and relays structured model and animation commands', async () => {
    const local = localShader()
    const repository = createRepository([local])
    const viewer = createViewer()
    const workspace = renderWorkspace({ repository, viewer })
    await ready(workspace)
    await act(async () => workspace.current().commands.selectShader(local.id))

    await act(async () => workspace.current().commands.capturePortrait())
    expect(viewer.capturePortrait).not.toHaveBeenCalled()

    const root = new File(['model'], 'model.glb')
    await act(async () => workspace.current().commands.loadModel([root], root))
    expect(workspace.current().state.modelLoad).toEqual({ status: 'loaded', name: 'model.glb', meshCount: 2 })
    expect(workspace.current().state.animations).toEqual({
      clips: [{ id: 'clip-0', label: 'Idle' }, { id: 'clip-1', label: 'Run' }],
      selectedClipId: 'clip-0',
      playing: true,
    })

    vi.mocked(viewer.loadModel).mockRejectedValueOnce(new Error('replacement malformed'))
    const brokenRoot = new File(['broken'], 'broken.glb')
    await act(async () => workspace.current().commands.loadModel([brokenRoot], brokenRoot))
    expect(workspace.current().state.modelLoad).toEqual({ status: 'loaded', name: 'model.glb', meshCount: 2 })
    expect(workspace.current().state.animations).toEqual({
      clips: [{ id: 'clip-0', label: 'Idle' }, { id: 'clip-1', label: 'Run' }],
      selectedClipId: 'clip-0',
      playing: true,
    })

    vi.mocked(viewer.compileShader).mockResolvedValueOnce({
      status: 'error', generation: 20, diagnostics: [{ severity: 'error', message: 'invalid shader', raw: 'invalid' }],
    })
    await act(async () => workspace.current().commands.compile())
    await act(async () => workspace.current().commands.capturePortrait())
    expect(viewer.capturePortrait).not.toHaveBeenCalled()

    vi.mocked(viewer.compileShader).mockResolvedValueOnce({ status: 'valid', generation: 21 })
    await act(async () => workspace.current().commands.compile())

    act(() => workspace.current().commands.selectAnimation('clip-1'))
    act(() => workspace.current().commands.setAnimationPlaying(false))
    workspace.current().commands.fitModel()
    expect(viewer.selectAnimation).toHaveBeenCalledWith('clip-1')
    expect(viewer.setAnimationPlaying).toHaveBeenCalledWith(false)
    expect(viewer.fitModel).toHaveBeenCalled()

    await act(async () => workspace.current().commands.capturePortrait())
    expect(workspace.current().state.draft.portrait).toMatchObject({ kind: 'captured', width: 4, height: 4 })
    expect(workspace.current().state.dirty.portrait).toBe(true)
    expect(repository.save).toHaveBeenCalledTimes(0)
    expect(workspace.current().state.notices.at(-1)).toEqual({ kind: 'info', scope: 'capture', message: 'Captured portrait for Local shader' })
  })

  it('deletes only locals and selects the next local before the first built-in', async () => {
    const first = localShader({ id: 'first' })
    const second = localShader({ id: 'second' })
    const repository = createRepository([first, second])
    const workspace = renderWorkspace({ repository })
    await ready(workspace)
    await act(async () => workspace.current().commands.selectShader(first.id))

    await act(async () => workspace.current().commands.deleteShader())

    expect(repository.delete).toHaveBeenCalledWith('first')
    expect(workspace.current().state.selectedId).toBe('second')
  })

  it('deletes a non-selected local without replacing or compiling the active dirty draft', async () => {
    const first = localShader({ id: 'first' })
    const second = localShader({ id: 'second' })
    const repository = createRepository([first, second])
    const viewer = createViewer()
    const workspace = renderWorkspace({ repository, viewer })
    await ready(workspace)
    await act(async () => workspace.current().commands.selectShader(first.id))
    act(() => workspace.current().commands.editSource('unsaved source'))
    vi.mocked(viewer.compileShader).mockClear()

    await act(async () => workspace.current().commands.deleteShader(second.id))

    expect(workspace.current().state.selectedId).toBe('first')
    expect(workspace.current().state.draft.fragmentSource).toBe('unsaved source')
    expect(workspace.current().state.dirty.source).toBe(true)
    expect(viewer.compileShader).not.toHaveBeenCalled()
  })
})
