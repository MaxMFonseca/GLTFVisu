import { describe, expect, it } from 'vitest'
import { BUILTIN_SHADERS } from '../domain/builtins'
import { DEFAULT_ENVIRONMENT_DISPLAY_SETTINGS } from '../domain/environment'
import type { ShaderDefinition } from '../domain/shader'
import type { ModelTextureSlotInfo } from '../three/modelTextures/ModelTextureRegistry'
import {
  createInitialWorkspaceState,
  hasDirtyFields,
  workspaceReducer,
} from './workspaceReducer'

function localShader(overrides: Partial<ShaderDefinition> = {}): ShaderDefinition {
  return {
    id: 'local-one',
    name: 'Local shader',
    fragmentSource: 'void main() { outColor = vec4(1.0); }',
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

function textureSlot(overrides: Partial<ModelTextureSlotInfo> = {}): ModelTextureSlotInfo {
  return {
    id: 'material-0:base-color',
    materialId: 'material-0',
    materialLabel: 'Body',
    channel: 'base-color',
    label: 'Base color',
    previewUrl: 'blob:original',
    replaced: false,
    ...overrides,
  }
}

describe('workspaceReducer', () => {
  it('keeps the prior ready environment after a failed replacement', () => {
    const source = { kind: 'remote' as const, url: 'https://example.com/studio.hdr' }
    const initial = createInitialWorkspaceState(BUILTIN_SHADERS)
    const ready = workspaceReducer(
      workspaceReducer(initial, { type: 'environmentLoadStarted', generation: 1, label: 'Studio' }),
      { type: 'environmentLoadSucceeded', generation: 1, source },
    )
    const loading = workspaceReducer(ready, { type: 'environmentLoadStarted', generation: 2, label: 'Broken HDR' })
    const failed = workspaceReducer(loading, {
      type: 'environmentLoadFailed', generation: 2, message: 'Unable to load environment',
    })

    expect(failed.environment).toEqual({
      status: 'error',
      activeSource: source,
      error: 'Unable to load environment',
      settings: DEFAULT_ENVIRONMENT_DISPLAY_SETTINGS,
    })
    expect(failed.notices.at(-1)).toEqual({
      kind: 'error', scope: 'environment', message: 'Unable to load environment',
    })
  })

  it('ignores a stale environment completion after a newer source is ready', () => {
    const initial = createInitialWorkspaceState(BUILTIN_SHADERS)
    const first = workspaceReducer(initial, { type: 'environmentLoadStarted', generation: 1, label: 'First' })
    const second = workspaceReducer(first, { type: 'environmentLoadStarted', generation: 2, label: 'Second' })
    const newest = workspaceReducer(second, {
      type: 'environmentLoadSucceeded', generation: 2, source: { kind: 'remote', url: 'https://example.com/second.hdr' },
    })
    const stale = workspaceReducer(newest, {
      type: 'environmentLoadSucceeded', generation: 1, source: { kind: 'remote', url: 'https://example.com/first.hdr' },
    })

    expect(newest.environment.activeSource).toEqual({ kind: 'remote', url: 'https://example.com/second.hdr' })
    expect(stale).toBe(newest)
  })
  it('stores texture slots and restores them with the committed animated model when replacement fails', () => {
    const originalSlots = [textureSlot()]
    const loaded = workspaceReducer(createInitialWorkspaceState(BUILTIN_SHADERS), {
      type: 'modelLoadSucceeded', generation: 1,
      info: {
        name: 'robot.glb',
        meshCount: 2,
        animationClips: [{ id: 'clip-0', label: 'Idle' }],
        textureSlots: originalSlots,
      },
    })
    const paused = workspaceReducer(loaded, { type: 'animationsChanged', selectedClipId: 'clip-0', playing: false })
    const loading = workspaceReducer(paused, { type: 'modelLoadStarted', fileName: 'broken.glb' })
    const failed = workspaceReducer(loading, { type: 'operationFailed', scope: 'model', message: 'Malformed model' })

    expect(loading.modelLoad).toEqual({
      status: 'loading',
      fileName: 'broken.glb',
      retained: { name: 'robot.glb', meshCount: 2, textureSlots: originalSlots },
    })
    expect(loaded.modelLoad).toEqual({
      status: 'loaded', name: 'robot.glb', meshCount: 2, textureSlots: originalSlots,
    })
    expect(loaded.modelLoad.status === 'loaded' && loaded.modelLoad.textureSlots).not.toBe(originalSlots)
    expect(loading.animations).toEqual(paused.animations)
    expect(failed.modelLoad).toEqual({
      status: 'loaded', name: 'robot.glb', meshCount: 2, textureSlots: originalSlots,
    })
    expect(failed.animations).toEqual(paused.animations)
  })

  it('swaps replacement-model texture slots only after the replacement load succeeds', () => {
    const predecessorSlots = [textureSlot()]
    const replacementSlots = [textureSlot({
      id: 'material-0:normal', channel: 'normal', label: 'Normal', previewUrl: 'blob:replacement',
    })]
    const loaded = workspaceReducer(createInitialWorkspaceState(BUILTIN_SHADERS), {
      type: 'modelLoadSucceeded', generation: 1,
      info: { name: 'robot.glb', meshCount: 2, animationClips: [], textureSlots: predecessorSlots },
    })
    const loading = workspaceReducer(loaded, { type: 'modelLoadStarted', fileName: 'vehicle.glb' })
    const replaced = workspaceReducer(loading, {
      type: 'modelLoadSucceeded', generation: 2,
      info: { name: 'vehicle.glb', meshCount: 4, animationClips: [], textureSlots: replacementSlots },
    })

    expect(loading.modelLoad.status === 'loading' && loading.modelLoad.retained?.textureSlots)
      .toEqual(predecessorSlots)
    expect(replaced.modelLoad).toEqual({
      status: 'loaded', name: 'vehicle.glb', meshCount: 4, textureSlots: replacementSlots,
    })
  })

  it('immutably updates texture metadata only for the currently loaded model', () => {
    const originalSlots = [textureSlot()]
    const changedSlots = [textureSlot({ previewUrl: 'blob:replacement', replaced: true })]
    const loaded = workspaceReducer(createInitialWorkspaceState(BUILTIN_SHADERS), {
      type: 'modelLoadSucceeded', generation: 1,
      info: { name: 'robot.glb', meshCount: 2, animationClips: [], textureSlots: originalSlots },
    })

    const changed = workspaceReducer(loaded, {
      type: 'modelTexturesChanged', generation: 1, textureSlots: changedSlots,
    })
    const loading = workspaceReducer(changed, { type: 'modelLoadStarted', fileName: 'next.glb' })
    const stale = workspaceReducer(loading, {
      type: 'modelTexturesChanged', generation: 2, textureSlots: originalSlots,
    })

    expect(changed.modelLoad).toEqual({
      status: 'loaded', name: 'robot.glb', meshCount: 2, textureSlots: changedSlots,
    })
    expect(changed).not.toBe(loaded)
    expect(changed.modelLoad.status === 'loaded' && changed.modelLoad.textureSlots).not.toBe(changedSlots)
    expect(loaded.modelLoad.status === 'loaded' && loaded.modelLoad.textureSlots).toEqual(originalSlots)
    expect(stale).toBe(loading)
  })

  it('starts from the first built-in while repository hydration remains pending', () => {
    const state = createInitialWorkspaceState(BUILTIN_SHADERS)

    expect(state.selectedId).toBe(BUILTIN_SHADERS[0].id)
    expect(state.savedSnapshot).toEqual(BUILTIN_SHADERS[0])
    expect(state.draft).toEqual(BUILTIN_SHADERS[0])
    expect(state.draft).not.toBe(BUILTIN_SHADERS[0])
    expect(state.hydration).toBe('loading')
    expect(state.locals).toEqual([])
    expect(hasDirtyFields(state.dirty)).toBe(false)
  })

  it('hydrates locals without replacing the active built-in selection', () => {
    const initial = createInitialWorkspaceState(BUILTIN_SHADERS)
    const local = localShader()

    const state = workspaceReducer(initial, { type: 'hydrateSucceeded', locals: [local] })

    expect(state.hydration).toBe('ready')
    expect(state.locals).toEqual([local])
    expect(state.locals[0]).not.toBe(local)
    expect(state.selectedId).toBe(BUILTIN_SHADERS[0].id)
  })

  it('merges late hydration behind local records created after the request started', () => {
    const initial = createInitialWorkspaceState(BUILTIN_SHADERS)
    const created = localShader({ id: 'created', name: 'Created', updatedAt: 30 })
    const withCreated = workspaceReducer(initial, { type: 'installLocal', shader: created })
    const stored = localShader({ id: 'stored', name: 'Stored', updatedAt: 20 })

    const hydrated = workspaceReducer(withCreated, { type: 'hydrateSucceeded', locals: [stored] })

    expect(hydrated.locals.map((shader) => shader.id)).toEqual(['created', 'stored'])
    expect(hydrated.selectedId).toBe('created')
  })

  it('keeps built-ins immutable and tracks each local draft field independently', () => {
    const initial = createInitialWorkspaceState(BUILTIN_SHADERS)
    const blocked = workspaceReducer(initial, { type: 'editName', name: 'Cannot edit' })
    expect(blocked).toBe(initial)

    const selected = workspaceReducer(initial, { type: 'select', shader: localShader() })
    const renamed = workspaceReducer(selected, { type: 'editName', name: 'Edited' })
    const sourced = workspaceReducer(renamed, { type: 'editSource', source: 'void main() {}' })
    const schema = workspaceReducer(sourced, {
      type: 'editSchema',
      parameters: [{ id: 'enabled', type: 'boolean', uniformName: 'uEnabled', label: 'Enabled', defaultValue: true }],
      parameterValues: { enabled: true },
    })
    const valued = workspaceReducer(schema, { type: 'editValue', parameterId: 'enabled', value: false })
    const portrait = { kind: 'captured' as const, blob: new Blob(['x']), mimeType: 'image/png' as const, width: 1, height: 1 }
    const captured = workspaceReducer(valued, { type: 'portraitCaptured', portrait })

    expect(captured.dirty).toEqual({ name: true, source: true, schema: true, values: true, portrait: true })
    expect(captured.savedSnapshot).toEqual(localShader())
    expect(captured.draft).toMatchObject({
      name: 'Edited',
      fragmentSource: 'void main() {}',
      parameterValues: { enabled: false },
      portrait,
    })
  })

  it('keeps built-in runtime values in the session and restores them on selection', () => {
    const fresnel = BUILTIN_SHADERS.find((shader) => shader.id === 'builtin-fresnel')
    const toon = BUILTIN_SHADERS.find((shader) => shader.id === 'builtin-toon')
    if (fresnel === undefined || toon === undefined) throw new Error('Expected Fresnel and Toon built-ins')
    const selected = workspaceReducer(createInitialWorkspaceState(BUILTIN_SHADERS), {
      type: 'select', shader: fresnel,
    })

    const changed = workspaceReducer(selected, { type: 'editValue', parameterId: 'power', value: 6 })
    const away = workspaceReducer(changed, { type: 'select', shader: toon })
    const restored = workspaceReducer(away, { type: 'select', shader: fresnel })

    expect(changed.draft.parameterValues.power).toBe(6)
    expect(changed.builtinParameterValues['builtin-fresnel']?.power).toBe(6)
    expect(changed.dirty.values).toBe(false)
    expect(restored.draft.parameterValues.power).toBe(6)
  })

  it('does not let compile results clear persistence dirty state and ignores stale generations', () => {
    const selected = workspaceReducer(createInitialWorkspaceState(BUILTIN_SHADERS), {
      type: 'select', shader: localShader(),
    })
    const dirty = workspaceReducer(selected, { type: 'editSource', source: 'new source' })
    const first = workspaceReducer(dirty, { type: 'compileStarted', generation: 1 })
    const second = workspaceReducer(first, { type: 'compileStarted', generation: 2 })
    const stale = workspaceReducer(second, {
      type: 'compileFinished',
      generation: 1,
      result: { status: 'error', generation: 20, diagnostics: [{ severity: 'error', message: 'old', raw: 'old' }] },
    })
    const current = workspaceReducer(stale, {
      type: 'compileFinished', generation: 2, result: { status: 'valid', generation: 21 },
    })

    expect(stale).toBe(second)
    expect(current.compile).toEqual({ generation: 2, status: 'valid', diagnostics: [] })
    expect(current.dirty.source).toBe(true)
  })

  it('records schema errors without compiling and retains the dirty draft', () => {
    const selected = workspaceReducer(createInitialWorkspaceState(BUILTIN_SHADERS), {
      type: 'select', shader: localShader(),
    })
    const dirty = workspaceReducer(selected, { type: 'editSchema', parameters: [], parameterValues: {} })
    const invalid = workspaceReducer(dirty, {
      type: 'schemaInvalid',
      generation: 2,
      errors: [{ parameterId: 'gain', field: 'uniformName', code: 'identifier', message: 'Invalid GLSL identifier' }],
    })
    const stale = workspaceReducer(invalid, {
      type: 'compileFinished', generation: 1, result: { status: 'valid', generation: 1 },
    })

    expect(invalid.compile.status).toBe('schema-invalid')
    expect(invalid.compile.generation).toBe(2)
    expect(invalid.schemaErrors).toHaveLength(1)
    expect(invalid.dirty.schema).toBe(true)
    expect(stale).toBe(invalid)
  })

  it('replaces saved and draft snapshots only after save succeeds', () => {
    const selected = workspaceReducer(createInitialWorkspaceState(BUILTIN_SHADERS), {
      type: 'select', shader: localShader(),
    })
    const dirty = workspaceReducer(selected, { type: 'editName', name: '  Normalized  ' })
    const saving = workspaceReducer(dirty, { type: 'saveStarted' })
    const failed = workspaceReducer(saving, { type: 'operationFailed', scope: 'save', message: 'Disk unavailable' })
    const normalized = localShader({ name: 'Normalized', updatedAt: 30 })
    const saved = workspaceReducer(failed, {
      type: 'saveSucceeded',
      shader: normalized,
      submittedRevisions: dirty.fieldRevisions,
      selectionRevision: dirty.selectionRevision,
    })

    expect(failed.draft.name).toBe('  Normalized  ')
    expect(failed.dirty.name).toBe(true)
    expect(failed.notices.at(-1)).toMatchObject({ kind: 'error', scope: 'save', message: 'Disk unavailable' })
    expect(saved.savedSnapshot).toEqual(normalized)
    expect(saved.draft).toEqual(normalized)
    expect(saved.draft).not.toBe(saved.savedSnapshot)
    expect(saved.dirty.name).toBe(false)
    expect(hasDirtyFields(saved.dirty)).toBe(false)
  })

  it('updates the saved snapshot without overwriting edits made while save is pending', () => {
    const selected = workspaceReducer(createInitialWorkspaceState(BUILTIN_SHADERS), {
      type: 'select', shader: localShader(),
    })
    const renamed = workspaceReducer(selected, { type: 'editName', name: 'Saved name' })
    const saving = workspaceReducer(renamed, { type: 'saveStarted' })
    const editedAgain = workspaceReducer(saving, { type: 'editSource', source: 'newer source' })
    const persisted = localShader({ name: 'Saved name', updatedAt: 30 })

    const state = workspaceReducer(editedAgain, {
      type: 'saveSucceeded',
      shader: persisted,
      submittedRevisions: renamed.fieldRevisions,
      selectionRevision: renamed.selectionRevision,
    })

    expect(state.savedSnapshot).toEqual(persisted)
    expect(state.draft.name).toBe('Saved name')
    expect(state.draft.fragmentSource).toBe('newer source')
    expect(state.dirty).toMatchObject({ name: false, source: true })
  })

  it('keeps a post-submit value edit dirty even when it returns to the persisted value', () => {
    const selected = workspaceReducer(createInitialWorkspaceState(BUILTIN_SHADERS), {
      type: 'select', shader: localShader(),
    })
    const renamed = workspaceReducer(selected, { type: 'editName', name: 'Saved name' })
    const saving = workspaceReducer(renamed, { type: 'saveStarted' })
    const changed = workspaceReducer(saving, { type: 'editValue', parameterId: 'gain', value: 2 })
    const returned = workspaceReducer(changed, { type: 'editValue', parameterId: 'gain', value: 1 })
    const persisted = localShader({ name: 'Saved name', updatedAt: 30 })

    const state = workspaceReducer(returned, {
      type: 'saveSucceeded',
      shader: persisted,
      submittedRevisions: renamed.fieldRevisions,
      selectionRevision: renamed.selectionRevision,
    })

    expect(state.draft.parameterValues.gain).toBe(1)
    expect(state.dirty.name).toBe(false)
    expect(state.dirty.values).toBe(true)
  })

  it('uses the supplied deterministic fallback after deleting a local shader', () => {
    const first = localShader({ id: 'first', name: 'First' })
    const second = localShader({ id: 'second', name: 'Second' })
    const hydrated = workspaceReducer(createInitialWorkspaceState(BUILTIN_SHADERS), {
      type: 'hydrateSucceeded', locals: [first, second],
    })
    const selected = workspaceReducer(hydrated, { type: 'select', shader: second })

    const state = workspaceReducer(selected, {
      type: 'deleteSucceeded', id: second.id, fallback: first,
    })

    expect(state.locals.map((shader) => shader.id)).toEqual(['first'])
    expect(state.selectedId).toBe('first')
    expect(state.savedSnapshot).toEqual(first)
    expect(hasDirtyFields(state.dirty)).toBe(false)
  })

  it('filters a non-selected deletion without replacing the active dirty draft', () => {
    const first = localShader({ id: 'first', name: 'First' })
    const second = localShader({ id: 'second', name: 'Second' })
    const hydrated = workspaceReducer(createInitialWorkspaceState(BUILTIN_SHADERS), {
      type: 'hydrateSucceeded', locals: [first, second],
    })
    const selected = workspaceReducer(hydrated, { type: 'select', shader: first })
    const dirty = workspaceReducer(selected, { type: 'editSource', source: 'unsaved source' })

    const state = workspaceReducer(dirty, { type: 'deleteSucceeded', id: second.id })

    expect(state.locals.map((shader) => shader.id)).toEqual(['first'])
    expect(state.selectedId).toBe('first')
    expect(state.draft.fragmentSource).toBe('unsaved source')
    expect(state.dirty.source).toBe(true)
  })
})
