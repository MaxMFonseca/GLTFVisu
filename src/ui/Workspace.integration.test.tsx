import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { forwardRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WorkspaceProvider,
  type ObjectUrlPort,
} from '../application/WorkspaceController'
import type { ShaderRepository } from '../application/ShaderRepository'
import type { CompileResult, ModelInfo, ViewerPort } from '../application/ViewerPort'
import { cloneShader } from '../application/workspaceState'
import { EnvironmentLoadError, type EnvironmentDefinition } from '../domain/environment'
import type { ShaderDefinition, ShaderDraft, ShaderPortrait } from '../domain/shader'
import type { ModelTextureSlotInfo } from '../three/modelTextures/ModelTextureRegistry'
import type {
  ShaderSourceEditorHandle,
  ShaderSourceEditorProps,
} from './editor/ShaderEditorPanel'
import { Workspace } from './Workspace'

const SourceEditor = forwardRef<ShaderSourceEditorHandle, ShaderSourceEditorProps>(
  function SourceEditor({ value, readOnly, onChange }, ref) {
    void ref
    return (
      <textarea
        aria-label="Fragment shader source"
        readOnly={readOnly}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    )
  },
)

interface RepositoryHarness extends ShaderRepository {
  readonly records: Map<string, ShaderDefinition>
  failSave: boolean
}

function createRepository(initial: readonly ShaderDefinition[] = []): RepositoryHarness {
  const records = new Map(initial.map((shader) => [shader.id, cloneShader(shader)]))
  const repository: RepositoryHarness = {
    records,
    failSave: false,
    list: vi.fn(async () => [...records.values()].map(cloneShader)),
    get: vi.fn(async (id) => {
      const shader = records.get(id)
      return shader === undefined ? undefined : cloneShader(shader)
    }),
    save: vi.fn(async (shader) => {
      if (repository.failSave) throw new Error('Storage offline')
      records.set(shader.id, cloneShader(shader))
    }),
    delete: vi.fn(async (id) => { records.delete(id) }),
  }
  return repository
}

interface ViewerHarness extends ViewerPort {
  runtimeSource?: string
  failCompile: boolean
  failModel: boolean
  failCapture: boolean
}

function createViewer(): ViewerHarness {
  let generation = 0
  const viewer: ViewerHarness = {
    failCompile: false,
    failModel: false,
    failCapture: false,
    loadModel: vi.fn(async (_files: File[], root: File): Promise<ModelInfo> => {
      if (viewer.failModel) throw new Error('Model decoder failed')
      return {
        name: root.name,
        meshCount: 2,
        animationClips: [{ id: 'clip-0', label: 'Idle' }, { id: 'clip-1', label: 'Turn' }],
        textureSlots: [],
      }
    }),
    replaceModelTexture: vi.fn(async () => []),
    restoreModelTexture: vi.fn(async () => []),
    fitModel: vi.fn(),
    resize: vi.fn(),
    compileShader: vi.fn(async (draft: ShaderDraft): Promise<CompileResult> => {
      generation += 1
      if (viewer.failCompile || draft.fragmentSource.includes('BROKEN')) {
        return {
          status: 'error',
          generation,
          diagnostics: [{ severity: 'error', message: 'Shader rejected', raw: 'Shader rejected' }],
        }
      }
      viewer.runtimeSource = draft.fragmentSource
      return { status: 'valid', generation }
    }),
    updateParameter: vi.fn(),
    loadEnvironment: vi.fn(async () => undefined),
    updateEnvironment: vi.fn(),
    capturePortrait: vi.fn(async (): Promise<ShaderPortrait> => {
      if (viewer.failCapture) throw new Error('Portrait capture failed')
      return {
        kind: 'captured',
        blob: new Blob(['captured-canvas'], { type: 'image/png' }),
        mimeType: 'image/png',
        width: 320,
        height: 200,
      }
    }),
    selectAnimation: vi.fn(),
    setAnimationPlaying: vi.fn(),
    dispose: vi.fn(),
  }
  return viewer
}

interface RenderOptions {
  repository: RepositoryHarness
  viewer: ViewerHarness
  environmentCatalog?: readonly EnvironmentDefinition[]
  defaultEnvironmentId?: string
  ids?: string[]
  urls?: ObjectUrlPort
  download?: (url: string, filename: string) => void
}

function renderWorkspace({
  repository,
  viewer,
  environmentCatalog,
  defaultEnvironmentId,
  ids = ['local-1', 'local-2'],
  urls,
  download,
}: RenderOptions) {
  let idIndex = 0
  return render(
    <WorkspaceProvider
      repository={repository}
      viewer={viewer}
      environmentCatalog={environmentCatalog}
      defaultEnvironmentId={defaultEnvironmentId}
      idFactory={() => ids[idIndex++] ?? `local-${idIndex}`}
      now={() => 100}
      urls={urls}
      download={download}
    >
      <Workspace SourceEditor={SourceEditor} mountViewer={() => ({ dispose: vi.fn() })} />
    </WorkspaceProvider>,
  )
}

function installPortraitUrlFake() {
  let nextUrl = 0
  const createObjectURL = vi.fn(() => `blob:portrait-${++nextUrl}`)
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
  return { createObjectURL, revokeObjectURL }
}

function useNarrowViewport(): void {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
}

function libraryPanel(): HTMLElement {
  return screen.getByRole('complementary', { name: 'Shader library panel' })
}

function editorPanel(): HTMLElement {
  return screen.getByRole('complementary', { name: 'Shader editor panel' })
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(blob)
  })
}

async function waitForValidCompile(): Promise<void> {
  await waitFor(() => expect(screen.getByText('Valid')).toBeVisible())
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function textureSlot(overrides: Partial<ModelTextureSlotInfo> = {}): ModelTextureSlotInfo {
  return {
    id: 'material-0:base-color',
    materialId: 'material-0',
    materialLabel: 'Armor',
    channel: 'base-color',
    label: 'Base color',
    previewUrl: 'blob:armor-original',
    replaced: false,
    ...overrides,
  }
}

const TEST_ENVIRONMENTS: readonly EnvironmentDefinition[] = [
  {
    id: 'starfield',
    name: 'Starfield',
    hdrUrl: './assets/starfield.hdr',
    license: 'CC0-1.0',
    sourceUrl: 'https://example.com/starfield',
    author: 'Test author',
  },
  {
    id: 'studio',
    name: 'Studio',
    hdrUrl: './assets/studio.hdr',
    license: 'CC0-1.0',
    sourceUrl: 'https://example.com/studio',
    author: 'Test author',
  },
]

async function waitForBuiltinControls(): Promise<void> {
  await screen.findByRole('heading', { name: 'Shader controls' })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('shader workspace acceptance', () => {
  it('round-trips an edited shader, parameter values, and a captured portrait through storage and a package', async () => {
    const user = userEvent.setup()
    installPortraitUrlFake()
    const repository = createRepository()
    const viewer = createViewer()
    const exportUrls = {
      createObjectURL: vi.fn((blob: Blob) => { void blob; return 'blob:export' }),
      revokeObjectURL: vi.fn(),
    }
    const download = vi.fn()
    const firstRender = renderWorkspace({ repository, viewer, urls: exportUrls, download })
    await waitForBuiltinControls()

    expect(within(libraryPanel()).getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-current', 'true')
    await user.click(within(libraryPanel()).getByRole('button', { name: 'Duplicate shader' }))
    const localCard = await within(libraryPanel()).findByRole('button', { name: 'Normal copy' })
    expect(localCard).toHaveAttribute('aria-current', 'true')
    expect(within(localCard).getByRole('img', { name: 'No preview for Normal copy' })).toBeVisible()

    const nameInput = within(editorPanel()).getByRole('textbox', { name: 'Shader name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Studio / Glow')
    const sourceInput = within(editorPanel()).getByRole('textbox', { name: 'Fragment shader source' })
    const previousRuntime = viewer.runtimeSource
    const compileCountBeforeError = vi.mocked(viewer.compileShader).mock.calls.length
    fireEvent.change(sourceInput, { target: { value: 'BROKEN' } })
    await waitFor(() => expect(viewer.compileShader).toHaveBeenCalledTimes(compileCountBeforeError + 1))
    expect(screen.getByText('Error')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Line 1: Shader rejected' })).toBeVisible()
    expect(viewer.runtimeSource).toBe(previousRuntime)

    const fixedSource = 'void main() { outColor = vec4(0.2, 0.4, 0.8, 1.0); }'
    fireEvent.change(sourceInput, { target: { value: fixedSource } })
    await waitForValidCompile()
    expect(viewer.runtimeSource).toBe(fixedSource)

    await user.click(within(editorPanel()).getByRole('button', { name: 'Add parameter' }))
    await user.click(within(editorPanel()).getByRole('button', { name: 'Add parameter' }))
    const gainLabel = within(editorPanel()).getByRole('textbox', { name: 'Parameter 1 label' })
    await user.clear(gainLabel)
    await user.type(gainLabel, 'Gain')
    await user.selectOptions(within(editorPanel()).getByRole('combobox', { name: 'Parameter 2 type' }), 'color')
    const tintLabel = within(editorPanel()).getByRole('textbox', { name: 'Parameter 2 label' })
    await user.clear(tintLabel)
    await user.type(tintLabel, 'Tint')
    await waitForValidCompile()

    const compileCountBeforeValues = vi.mocked(viewer.compileShader).mock.calls.length
    fireEvent.change(within(editorPanel()).getByRole('spinbutton', { name: 'Gain (uParameter1) value' }), { target: { value: '0.8' } })
    fireEvent.change(within(editorPanel()).getByLabelText('Tint (uParameter2) color picker'), { target: { value: '#336699' } })
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 450)) })
    expect(viewer.updateParameter).toHaveBeenCalledTimes(2)
    expect(viewer.compileShader).toHaveBeenCalledTimes(compileCountBeforeValues)
    expect(repository.save).toHaveBeenCalledTimes(1)

    await user.click(within(editorPanel()).getByRole('button', { name: 'Save shader' }))
    await waitFor(() => expect(screen.getByText('Saved Studio / Glow')).toBeVisible())
    expect(repository.save).toHaveBeenCalledTimes(2)
    expect(repository.records.get('local-1')).toMatchObject({
      name: 'Studio / Glow',
      fragmentSource: fixedSource,
      parameters: [{ type: 'float' }, { type: 'color' }],
    })
    expect(Object.values(repository.records.get('local-1')?.parameterValues ?? {})).toEqual([0.8, '#336699'])

    firstRender.unmount()
    const hydratedRender = renderWorkspace({ repository, viewer, urls: exportUrls, download, ids: ['local-2'] })
    await waitForBuiltinControls()
    await user.click(await within(libraryPanel()).findByRole('button', { name: 'Studio / Glow' }))
    await waitFor(() => expect(within(editorPanel()).getByRole('textbox', { name: 'Shader name' })).toHaveValue('Studio / Glow'))
    expect(within(editorPanel()).getByRole('textbox', { name: 'Fragment shader source' })).toHaveValue(fixedSource)
    expect(within(libraryPanel()).getByRole('img', { name: 'No preview for Studio / Glow' })).toBeVisible()

    const model = new File(['glb'], 'robot.glb', { type: 'model/gltf-binary' })
    await user.upload(within(libraryPanel()).getByLabelText('Choose model files'), model)
    await within(libraryPanel()).findByText('robot.glb · 2 renderables')
    const savesBeforeCapture = vi.mocked(repository.save).mock.calls.length
    await user.click(within(editorPanel()).getByRole('button', { name: 'Capture portrait' }))
    expect(await within(libraryPanel()).findByRole('img', { name: 'Studio / Glow preview' })).toHaveAttribute('src', 'blob:portrait-1')
    expect(screen.getByText('Unsaved changes')).toBeVisible()
    expect(repository.save).toHaveBeenCalledTimes(savesBeforeCapture)
    expect(screen.getByText('Captured portrait for Studio / Glow')).toBeVisible()

    await user.click(within(editorPanel()).getByRole('button', { name: 'Save shader' }))
    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(savesBeforeCapture + 1))
    hydratedRender.unmount()

    renderWorkspace({ repository, viewer, urls: exportUrls, download, ids: ['local-2'] })
    await waitForBuiltinControls()
    await user.click(await within(libraryPanel()).findByRole('button', { name: 'Studio / Glow' }))
    const restoredPortrait = await within(libraryPanel()).findByRole('img', { name: 'Studio / Glow preview' })
    expect(restoredPortrait.getAttribute('src')).toMatch(/^blob:portrait-/)

    await user.click(within(libraryPanel()).getByRole('button', { name: 'Export shader' }))
    await waitFor(() => expect(download).toHaveBeenCalledWith('blob:export', 'Studio - Glow.shader.json'))
    expect(exportUrls.revokeObjectURL).toHaveBeenCalledWith('blob:export')
    const exportedBlob = exportUrls.createObjectURL.mock.calls.at(-1)?.[0]
    expect(exportedBlob).toBeInstanceOf(Blob)
    const exportedJson = await readBlob(exportedBlob as Blob)
    expect(JSON.parse(exportedJson)).toMatchObject({
      format: 'gltf-shader-visualizer',
      version: 2,
      shader: { name: 'Studio / Glow', fragmentSource: fixedSource },
    })

    await user.click(within(libraryPanel()).getByRole('button', { name: 'Delete shader' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(repository.records.size).toBe(0))
    expect(within(libraryPanel()).queryByRole('button', { name: 'Studio / Glow' })).not.toBeInTheDocument()

    const importInput = within(libraryPanel()).getByLabelText('Import shader file') as HTMLInputElement
    await user.upload(importInput, new File([exportedJson], 'restored.shader.json', { type: 'application/json' }))
    await waitFor(() => expect(repository.records.has('local-2')).toBe(true))
    expect(importInput.value).toBe('')
    expect(repository.records.get('local-2')).toMatchObject({
      id: 'local-2',
      name: 'Studio / Glow',
      fragmentSource: fixedSource,
      origin: 'local',
      parameters: [{ type: 'float' }, { type: 'color' }],
      portrait: { kind: 'captured', width: 320, height: 200 },
    })
    expect(Object.values(repository.records.get('local-2')?.parameterValues ?? {})).toEqual([0.8, '#336699'])
    expect(await within(libraryPanel()).findByRole('img', { name: 'Studio / Glow preview' })).toBeVisible()
  }, 15_000)

  it('replaces and restores a loaded model texture without compiling the shader', async () => {
    const user = userEvent.setup()
    const repository = createRepository()
    const viewer = createViewer()
    const originalSlots = [textureSlot()]
    const replacedSlots = [textureSlot({ previewUrl: 'blob:armor-replacement', replaced: true })]
    vi.mocked(viewer.loadModel).mockResolvedValueOnce({
      name: 'armor.glb', meshCount: 1, animationClips: [], textureSlots: originalSlots,
    })
    vi.mocked(viewer.replaceModelTexture).mockResolvedValueOnce(replacedSlots)
    vi.mocked(viewer.restoreModelTexture).mockResolvedValueOnce(originalSlots)
    renderWorkspace({ repository, viewer })
    await waitForBuiltinControls()

    await user.upload(
      within(libraryPanel()).getByLabelText('Choose model files'),
      new File(['model'], 'armor.glb', { type: 'model/gltf-binary' }),
    )
    await within(libraryPanel()).findByRole('heading', { name: 'Model textures' })
    const compileCount = vi.mocked(viewer.compileShader).mock.calls.length
    const replacement = new File(['replacement'], 'armor.png', { type: 'image/png' })

    await user.upload(within(libraryPanel()).getByLabelText('Replace Armor base color'), replacement)
    await waitFor(() => expect(viewer.replaceModelTexture)
      .toHaveBeenCalledWith('material-0:base-color', replacement))
    expect(within(libraryPanel()).getByRole('img', { name: 'Armor Base color texture preview' }))
      .toHaveAttribute('src', 'blob:armor-replacement')
    expect(within(libraryPanel()).getByText('Replacement')).toBeVisible()
    const restore = within(libraryPanel()).getByRole('button', { name: 'Restore Armor base color' })
    expect(restore).toBeEnabled()
    expect(viewer.compileShader).toHaveBeenCalledTimes(compileCount)

    await user.click(restore)
    await waitFor(() => expect(viewer.restoreModelTexture).toHaveBeenCalledWith('material-0:base-color'))
    expect(within(libraryPanel()).getByRole('img', { name: 'Armor Base color texture preview' }))
      .toHaveAttribute('src', 'blob:armor-original')
    expect(within(libraryPanel()).getByText('Original')).toBeVisible()
    expect(restore).toBeDisabled()
    expect(viewer.compileShader).toHaveBeenCalledTimes(compileCount)
  })

  it('leaves the library unchanged for retryable malformed and unsupported imports', async () => {
    const user = userEvent.setup()
    installPortraitUrlFake()
    const repository = createRepository()
    const viewer = createViewer()
    renderWorkspace({ repository, viewer })
    await waitForBuiltinControls()
    const input = within(libraryPanel()).getByLabelText('Import shader file') as HTMLInputElement
    const malformed = new File(['{broken'], 'broken.json', { type: 'application/json' })

    await user.upload(input, malformed)
    expect(await screen.findByText('Malformed shader JSON')).toBeVisible()
    expect(input.value).toBe('')
    expect(repository.records.size).toBe(0)

    await user.upload(input, malformed)
    await waitFor(() => expect(screen.getAllByText('Malformed shader JSON')).toHaveLength(2))
    expect(repository.records.size).toBe(0)

    const unsupported = new File([JSON.stringify({
      format: 'gltf-shader-visualizer',
      version: 99,
      shader: {},
    })], 'future.json', { type: 'application/json' })
    await user.upload(input, unsupported)
    expect(await screen.findByText('Unsupported shader package version')).toBeVisible()
    expect(repository.records.size).toBe(0)

    const invalidValues = new File([JSON.stringify({
      format: 'gltf-shader-visualizer',
      version: 1,
      shader: {
        name: 'Invalid values',
        fragmentSource: 'void main() { outColor = vec4(uGain); }',
        parameters: [
          { id: 'gain', type: 'float', uniformName: 'uGain', label: 'Gain', min: 0, max: 2, step: 0.1, defaultValue: 1 },
        ],
        parameterValues: {},
      },
    })], 'invalid-values.json', { type: 'application/json' })
    await user.upload(input, invalidValues)
    expect(await screen.findByText('Invalid shader parameter values')).toBeVisible()
    expect(input.value).toBe('')
    expect(repository.records.size).toBe(0)
  })

  it('keeps compile, storage, model, and capture failures visible and retryable', async () => {
    const user = userEvent.setup()
    installPortraitUrlFake()
    const repository = createRepository()
    const viewer = createViewer()
    renderWorkspace({ repository, viewer })
    await waitForBuiltinControls()
    await user.click(within(libraryPanel()).getByRole('button', { name: 'Duplicate shader' }))
    await within(libraryPanel()).findByRole('button', { name: 'Normal copy' })
    await waitFor(() => expect(viewer.compileShader).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'local-1' })))
    await waitForValidCompile()

    const source = within(editorPanel()).getByRole('textbox', { name: 'Fragment shader source' })
    const compileCountBeforeFailure = vi.mocked(viewer.compileShader).mock.calls.length
    viewer.failCompile = true
    fireEvent.change(source, { target: { value: 'temporarily invalid' } })
    await waitFor(() => expect(viewer.compileShader).toHaveBeenCalledTimes(compileCountBeforeFailure + 1))
    expect(await screen.findByRole('button', { name: 'Line 1: Shader rejected' })).toBeVisible()
    viewer.failCompile = false
    fireEvent.change(source, { target: { value: 'void main() { outColor = vec4(1.0); }' } })
    await waitForValidCompile()

    repository.failSave = true
    await user.type(within(editorPanel()).getByRole('textbox', { name: 'Shader name' }), ' retry')
    await user.click(within(editorPanel()).getByRole('button', { name: 'Save shader' }))
    expect(await screen.findByText('Storage offline')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Dismiss workspace notices' }))
    repository.failSave = false
    await user.click(within(editorPanel()).getByRole('button', { name: 'Save shader' }))
    expect(await screen.findByText('Saved Normal copy retry')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Dismiss workspace notices' }))

    viewer.failModel = true
    await user.upload(within(libraryPanel()).getByLabelText('Choose model files'), new File(['bad'], 'bad.glb'))
    expect((await screen.findAllByText('Model decoder failed')).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Dismiss workspace notices' }))
    viewer.failModel = false
    await user.upload(within(libraryPanel()).getByLabelText('Choose model files'), new File(['good'], 'good.glb'))
    await within(libraryPanel()).findByText('good.glb · 2 renderables')

    viewer.failCapture = true
    await user.click(within(editorPanel()).getByRole('button', { name: 'Capture portrait' }))
    expect(await screen.findByText('Portrait capture failed')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Dismiss workspace notices' }))
    viewer.failCapture = false
    await user.click(within(editorPanel()).getByRole('button', { name: 'Capture portrait' }))
    expect(await screen.findByText('Captured portrait for Normal copy retry')).toBeVisible()
  }, 10_000)

  it('updates built-in controls without compilation and preserves current Toon and PBR values when duplicated', async () => {
    const user = userEvent.setup()
    const repository = createRepository()
    const viewer = createViewer()
    const firstRender = renderWorkspace({ repository, viewer })
    await waitForBuiltinControls()

    await user.click(within(libraryPanel()).getByRole('button', { name: 'PBR' }))
    await waitFor(() => expect(viewer.compileShader).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'builtin-pbr' })))
    expect(within(editorPanel()).queryByLabelText('Shader name')).not.toBeInTheDocument()
    vi.mocked(viewer.compileShader).mockClear()

    const roughness = within(editorPanel()).getByRole('spinbutton', { name: /Roughness multiplier/ })
    await user.clear(roughness)
    await user.type(roughness, '0.35')
    expect(viewer.updateParameter).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'roughness-multiplier' }),
      0.35,
    )
    expect(viewer.compileShader).not.toHaveBeenCalled()

    await user.click(within(libraryPanel()).getByRole('button', { name: 'Toon' }))
    const bands = within(editorPanel()).getByRole('spinbutton', { name: /Bands/ })
    await user.clear(bands)
    await user.type(bands, '5')
    await user.click(within(libraryPanel()).getByRole('button', { name: 'PBR' }))
    expect(within(editorPanel()).getByRole('spinbutton', { name: /Roughness multiplier/ })).toHaveValue(0.35)
    await user.click(within(libraryPanel()).getByRole('button', { name: 'Toon' }))
    expect(within(editorPanel()).getByRole('spinbutton', { name: /Bands/ })).toHaveValue(5)

    await user.click(within(libraryPanel()).getByRole('button', { name: 'Duplicate shader' }))
    await within(libraryPanel()).findByRole('button', { name: 'Toon copy' })
    expect(repository.records.get('local-1')).toMatchObject({
      origin: 'local',
      materialInputProfile: 'gltf-surface',
      schemaVersion: 2,
      parameterValues: { bands: 5 },
    })
    expect(within(editorPanel()).getByRole('heading', { name: 'Shader editor' })).toBeVisible()
    expect(within(editorPanel()).getByRole('textbox', { name: 'Shader name' })).toHaveValue('Toon copy')
    expect((within(editorPanel()).getByRole('textbox', { name: 'Fragment shader source' }) as HTMLTextAreaElement).value)
      .toContain('sampleGltfBaseColor')
    expect(within(editorPanel()).getByRole('heading', { name: 'Parameter definitions' })).toBeVisible()

    await user.click(within(libraryPanel()).getByRole('button', { name: 'PBR' }))
    await user.click(within(libraryPanel()).getByRole('button', { name: 'Duplicate shader' }))
    await within(libraryPanel()).findByRole('button', { name: 'PBR copy' })
    expect(repository.records.get('local-2')).toMatchObject({
      origin: 'local',
      materialInputProfile: 'gltf-pbr',
      schemaVersion: 2,
      parameterValues: { 'roughness-multiplier': 0.35 },
    })
    expect((within(editorPanel()).getByRole('textbox', { name: 'Fragment shader source' }) as HTMLTextAreaElement).value)
      .toContain('distributionGGX')
    expect(within(editorPanel()).getByRole('heading', { name: 'Parameter definitions' })).toBeVisible()

    firstRender.unmount()
    renderWorkspace({ repository, viewer, ids: ['local-3'] })
    await waitForBuiltinControls()
    await user.click(within(libraryPanel()).getByRole('button', { name: 'PBR' }))
    expect(within(editorPanel()).getByRole('spinbutton', { name: /Roughness multiplier/ })).toHaveValue(1)
    await user.click(within(libraryPanel()).getByRole('button', { name: 'Toon' }))
    expect(within(editorPanel()).getByRole('spinbutton', { name: /Bands/ })).toHaveValue(3)
  }, 10_000)

  it('supersedes a pending environment request while controls and failures remain visible', async () => {
    const user = userEvent.setup()
    const repository = createRepository()
    const viewer = createViewer()
    const older = deferred()
    const newest = deferred()
    vi.mocked(viewer.loadEnvironment).mockImplementation((source) => {
      if (source.kind === 'bundled') return older.promise
      if (source.kind === 'remote' && source.url === 'https://example.com/newest.hdr') return newest.promise
      if (source.kind === 'remote' && source.url === 'https://example.com/broken.hdr') {
        return Promise.reject(new EnvironmentLoadError('Remote HDR could not be decoded'))
      }
      return Promise.resolve()
    })
    renderWorkspace({ repository, viewer, environmentCatalog: TEST_ENVIRONMENTS })
    await waitForBuiltinControls()

    await user.click(screen.getByRole('button', { name: 'Environment' }))
    const popover = screen.getByRole('region', { name: 'Environment settings' })
    const bundled = within(popover).getByRole('combobox', { name: 'Bundled environment' })
    await user.selectOptions(bundled, 'starfield')
    expect(await within(popover).findByRole('status')).toHaveTextContent('Loading Starfield')

    await user.click(within(popover).getByRole('radio', { name: 'Clear color' }))
    fireEvent.change(within(popover).getByRole('slider', { name: 'Environment rotation' }), { target: { value: '75' } })
    fireEvent.change(within(popover).getByRole('slider', { name: 'Environment intensity' }), { target: { value: '1.7' } })
    expect(viewer.updateEnvironment).toHaveBeenLastCalledWith({
      backgroundMode: 'clear-color',
      clearColor: '#17191d',
      rotation: 75,
      intensity: 1.7,
    })

    const remoteUrl = within(popover).getByRole('textbox', { name: 'HDR URL' })
    await user.type(remoteUrl, 'http://example.com/not-secure.hdr')
    await user.click(within(popover).getByRole('button', { name: 'Load HDR URL' }))
    expect(await screen.findByText('Environment URL must use HTTPS')).toBeVisible()
    expect(viewer.loadEnvironment).toHaveBeenCalledTimes(1)

    await user.clear(remoteUrl)
    await user.type(remoteUrl, 'https://example.com/newest.hdr')
    await user.click(within(popover).getByRole('button', { name: 'Load HDR URL' }))
    expect(viewer.loadEnvironment).toHaveBeenLastCalledWith({ kind: 'remote', url: 'https://example.com/newest.hdr' })
    await act(async () => newest.resolve())
    await waitFor(() => expect(within(popover).queryByRole('status')).not.toBeInTheDocument())
    expect(bundled).toHaveValue('')

    await act(async () => older.resolve())
    expect(bundled).toHaveValue('')

    await user.clear(remoteUrl)
    await user.type(remoteUrl, 'https://example.com/broken.hdr')
    await user.click(within(popover).getByRole('button', { name: 'Load HDR URL' }))
    expect(await within(popover).findByRole('alert')).toHaveTextContent('Remote HDR could not be decoded')
    expect(screen.getAllByText('Remote HDR could not be decoded')).toHaveLength(2)
    expect(bundled).toHaveValue('')
  }, 10_000)

  it('connects narrow tab semantics and keyboard activation to the viewer resize port', async () => {
    useNarrowViewport()
    const user = userEvent.setup()
    installPortraitUrlFake()
    const repository = createRepository()
    const viewer = createViewer()
    renderWorkspace({ repository, viewer })

    const tabs = screen.getByRole('tablist', { name: 'Workspace panels' })
    const library = within(tabs).getByRole('tab', { name: 'Library' })
    const viewerTab = within(tabs).getByRole('tab', { name: 'Viewer' })
    const editor = within(tabs).getByRole('tab', { name: 'Editor' })
    expect(viewerTab).toHaveAttribute('aria-controls', 'shader-viewer-panel')
    expect(viewerTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Viewer' })).toBeVisible()

    await user.click(library)
    expect(screen.getByRole('tabpanel', { name: 'Library' })).toBeVisible()
    vi.mocked(viewer.resize).mockClear()
    await user.keyboard('{ArrowRight}')
    expect(viewerTab).toHaveFocus()
    await waitFor(() => expect(viewer.resize).toHaveBeenCalledOnce())

    await user.keyboard('{End}')
    expect(editor).toHaveFocus()
    expect(editor).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Editor' })).toBeVisible()
  })

  it('keeps narrow workspace tabs inert while the delete dialog is modal', async () => {
    useNarrowViewport()
    const user = userEvent.setup()
    installPortraitUrlFake()
    const repository = createRepository()
    const viewer = createViewer()
    const { container } = renderWorkspace({ repository, viewer })
    const tabs = screen.getByRole('tablist', { name: 'Workspace panels' })
    const library = within(tabs).getByRole('tab', { name: 'Library' })
    const editor = within(tabs).getByRole('tab', { name: 'Editor' })

    await user.click(library)
    await user.click(within(screen.getByRole('tabpanel', { name: 'Library' })).getByRole('button', { name: 'Duplicate shader' }))
    await screen.findByRole('button', { name: 'Normal copy' })
    const deleteButton = within(screen.getByRole('tabpanel', { name: 'Library' })).getByRole('button', { name: 'Delete shader' })
    await user.click(deleteButton)

    const workspace = container.querySelector('.workspace-root')
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Normal copy?' })
    expect(workspace).toHaveProperty('inert', true)
    expect(workspace).toHaveAttribute('aria-hidden', 'true')
    expect(workspace).not.toContainElement(dialog)

    await user.click(editor)
    expect(library).toHaveAttribute('aria-selected', 'true')
    expect(editor).toHaveAttribute('aria-selected', 'false')
    expect(dialog).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(workspace).toHaveProperty('inert', false)
    expect(workspace).not.toHaveAttribute('aria-hidden')
    expect(deleteButton).toHaveFocus()
  })
})
