import { describe, expect, it } from 'vitest'
import { BUILTIN_SHADERS } from '../domain/builtins'
import type { ShaderDefinition } from '../domain/shader'
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
    schemaVersion: 1,
    ...overrides,
  }
}

describe('workspaceReducer', () => {
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
      errors: [{ parameterId: 'gain', field: 'uniformName', code: 'identifier', message: 'Invalid GLSL identifier' }],
    })

    expect(invalid.compile.status).toBe('schema-invalid')
    expect(invalid.schemaErrors).toHaveLength(1)
    expect(invalid.dirty.schema).toBe(true)
  })

  it('replaces saved and draft snapshots only after save succeeds', () => {
    const selected = workspaceReducer(createInitialWorkspaceState(BUILTIN_SHADERS), {
      type: 'select', shader: localShader(),
    })
    const dirty = workspaceReducer(selected, { type: 'editName', name: '  Normalized  ' })
    const saving = workspaceReducer(dirty, { type: 'saveStarted' })
    const failed = workspaceReducer(saving, { type: 'operationFailed', scope: 'save', message: 'Disk unavailable' })
    const normalized = localShader({ name: 'Normalized', updatedAt: 30 })
    const saved = workspaceReducer(failed, { type: 'saveSucceeded', shader: normalized })

    expect(failed.draft.name).toBe('  Normalized  ')
    expect(failed.dirty.name).toBe(true)
    expect(failed.notices.at(-1)).toMatchObject({ kind: 'error', scope: 'save', message: 'Disk unavailable' })
    expect(saved.savedSnapshot).toEqual(normalized)
    expect(saved.draft).toEqual(normalized)
    expect(saved.draft).not.toBe(saved.savedSnapshot)
    expect(hasDirtyFields(saved.dirty)).toBe(false)
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
})
