import type { ShaderParameterDefinition, ShaderParameterValue } from '../domain/parameters'
import type { ShaderDefinition, ShaderPortrait } from '../domain/shader'
import type { ParameterDefinitionValidationError } from '../domain/uniformValidation'
import type { CompileResult, ModelInfo } from '../three/ViewerEngine'
import {
  cleanDirtyFields,
  cloneShader,
  type WorkspaceNotice,
  type WorkspaceState,
} from './workspaceState'

export { hasDirtyFields } from './workspaceState'
export type { WorkspaceDirtyFields, WorkspaceState } from './workspaceState'

export type WorkspaceAction =
  | { type: 'hydrateSucceeded'; locals: readonly ShaderDefinition[] }
  | { type: 'hydrateFailed'; message: string }
  | { type: 'select'; shader: ShaderDefinition }
  | { type: 'installLocal'; shader: ShaderDefinition; message?: string }
  | { type: 'editName'; name: string }
  | { type: 'editSource'; source: string }
  | { type: 'editSchema'; parameters: ShaderParameterDefinition[]; parameterValues: Record<string, ShaderParameterValue> }
  | { type: 'editValue'; parameterId: string; value: ShaderParameterValue }
  | { type: 'portraitCaptured'; portrait: ShaderPortrait }
  | { type: 'compileInvalidated'; generation: number }
  | { type: 'compileStarted'; generation: number }
  | { type: 'compileFinished'; generation: number; result: CompileResult }
  | { type: 'schemaInvalid'; generation: number; errors: readonly ParameterDefinitionValidationError[] }
  | { type: 'saveStarted' }
  | { type: 'saveSucceeded'; shader: ShaderDefinition; draftRevision: number }
  | { type: 'deleteSucceeded'; id: string; fallback?: ShaderDefinition }
  | { type: 'modelLoadStarted'; fileName: string }
  | { type: 'modelLoadSucceeded'; info: ModelInfo }
  | { type: 'animationsChanged'; selectedClip?: string; playing: boolean }
  | { type: 'operationFailed'; scope: WorkspaceNotice['scope']; message: string }
  | { type: 'clearNotices' }

export function createInitialWorkspaceState(builtins: readonly ShaderDefinition[]): WorkspaceState {
  const first = builtins[0]
  if (first === undefined) throw new Error('Workspace requires at least one built-in shader')
  return {
    builtins,
    locals: [],
    selectedId: first.id,
    savedSnapshot: cloneShader(first),
    draft: cloneShader(first),
    draftRevision: 0,
    dirty: cleanDirtyFields(),
    hydration: 'loading',
    persistence: 'idle',
    schemaErrors: [],
    compile: { generation: 0, status: 'idle', diagnostics: [] },
    modelLoad: { status: 'empty' },
    animations: { clipNames: [], playing: false },
    notices: [],
  }
}

function selectedState(state: WorkspaceState, shader: ShaderDefinition): WorkspaceState {
  return {
    ...state,
    selectedId: shader.id,
    savedSnapshot: cloneShader(shader),
    draft: cloneShader(shader),
    draftRevision: state.draftRevision + 1,
    dirty: cleanDirtyFields(),
    schemaErrors: [],
    compile: { generation: state.compile.generation, status: 'idle', diagnostics: [] },
  }
}

function appendNotice(state: WorkspaceState, notice: WorkspaceNotice): readonly WorkspaceNotice[] {
  return [...state.notices, notice]
}

function replaceLocal(locals: readonly ShaderDefinition[], shader: ShaderDefinition): readonly ShaderDefinition[] {
  const snapshot = cloneShader(shader)
  const index = locals.findIndex((candidate) => candidate.id === shader.id)
  if (index < 0) return [snapshot, ...locals]
  return locals.map((candidate, candidateIndex) => candidateIndex === index ? snapshot : candidate)
}

function mergeHydratedLocals(
  current: readonly ShaderDefinition[],
  hydrated: readonly ShaderDefinition[],
): readonly ShaderDefinition[] {
  const currentIds = new Set(current.map((shader) => shader.id))
  return [...current.map(cloneShader), ...hydrated.filter((shader) => !currentIds.has(shader.id)).map(cloneShader)]
}

function parameterDefinitionsEqual(
  left: readonly ShaderParameterDefinition[],
  right: readonly ShaderParameterDefinition[],
): boolean {
  return left.length === right.length && left.every((parameter, index) => {
    const candidate = right[index]
    if (
      candidate === undefined
      || parameter.id !== candidate.id
      || parameter.type !== candidate.type
      || parameter.uniformName !== candidate.uniformName
      || parameter.label !== candidate.label
      || parameter.defaultValue !== candidate.defaultValue
    ) return false
    if (parameter.type === 'float' || parameter.type === 'integer') {
      return (candidate.type === 'float' || candidate.type === 'integer')
        && parameter.min === candidate.min
        && parameter.max === candidate.max
        && parameter.step === candidate.step
    }
    return true
  })
}

function parameterValuesEqual(
  left: Readonly<Record<string, ShaderParameterValue>>,
  right: Readonly<Record<string, ShaderParameterValue>>,
): boolean {
  const leftKeys = Object.keys(left)
  return leftKeys.length === Object.keys(right).length
    && leftKeys.every((key) => Object.hasOwn(right, key) && left[key] === right[key])
}

function portraitsEqual(left: ShaderDefinition['portrait'], right: ShaderDefinition['portrait']): boolean {
  if (left === undefined || right === undefined) return left === right
  if (left.kind !== right.kind) return false
  if (left.kind === 'bundled' && right.kind === 'bundled') return left.url === right.url
  return left.kind === 'captured' && right.kind === 'captured'
    && left.blob === right.blob
    && left.mimeType === right.mimeType
    && left.width === right.width
    && left.height === right.height
}

function dirtyComparedTo(draft: ShaderDefinition, saved: ShaderDefinition) {
  return {
    name: draft.name !== saved.name,
    source: draft.fragmentSource !== saved.fragmentSource,
    schema: !parameterDefinitionsEqual(draft.parameters, saved.parameters),
    values: !parameterValuesEqual(draft.parameterValues, saved.parameterValues),
    portrait: !portraitsEqual(draft.portrait, saved.portrait),
  }
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'hydrateSucceeded':
      return { ...state, hydration: 'ready', locals: mergeHydratedLocals(state.locals, action.locals) }
    case 'hydrateFailed':
      return {
        ...state,
        hydration: 'error',
        notices: appendNotice(state, { kind: 'error', scope: 'hydrate', message: action.message }),
      }
    case 'select':
      return selectedState(state, action.shader)
    case 'installLocal': {
      const next = selectedState({ ...state, locals: replaceLocal(state.locals, action.shader) }, action.shader)
      return action.message === undefined ? next : {
        ...next,
        notices: appendNotice(next, { kind: 'info', scope: 'import', message: action.message }),
      }
    }
    case 'editName':
      if (state.draft.origin === 'builtin') return state
      return {
        ...state,
        draft: { ...state.draft, name: action.name },
        draftRevision: state.draftRevision + 1,
        dirty: { ...state.dirty, name: true },
      }
    case 'editSource':
      if (state.draft.origin === 'builtin') return state
      return {
        ...state,
        draft: { ...state.draft, fragmentSource: action.source },
        draftRevision: state.draftRevision + 1,
        dirty: { ...state.dirty, source: true },
      }
    case 'editSchema':
      if (state.draft.origin === 'builtin') return state
      return {
        ...state,
        draft: {
          ...state.draft,
          parameters: action.parameters.map((parameter) => ({ ...parameter })),
          parameterValues: { ...action.parameterValues },
        },
        draftRevision: state.draftRevision + 1,
        dirty: { ...state.dirty, schema: true },
        schemaErrors: [],
      }
    case 'editValue':
      if (state.draft.origin === 'builtin') return state
      return {
        ...state,
        draft: {
          ...state.draft,
          parameterValues: { ...state.draft.parameterValues, [action.parameterId]: action.value },
        },
        draftRevision: state.draftRevision + 1,
        dirty: { ...state.dirty, values: true },
      }
    case 'portraitCaptured':
      if (state.draft.origin === 'builtin') return state
      return {
        ...state,
        draft: { ...state.draft, portrait: action.portrait },
        draftRevision: state.draftRevision + 1,
        dirty: { ...state.dirty, portrait: true },
      }
    case 'compileInvalidated':
      return { ...state, compile: { generation: action.generation, status: 'idle', diagnostics: [] } }
    case 'compileStarted':
      return {
        ...state,
        compile: { generation: action.generation, status: 'pending', diagnostics: [] },
        schemaErrors: [],
      }
    case 'compileFinished':
      if (action.generation !== state.compile.generation) return state
      return {
        ...state,
        compile: action.result.status === 'valid'
          ? { generation: action.generation, status: 'valid', diagnostics: [] }
          : { generation: action.generation, status: 'error', diagnostics: action.result.diagnostics },
      }
    case 'schemaInvalid':
      return {
        ...state,
        schemaErrors: action.errors,
        compile: { generation: action.generation, status: 'schema-invalid', diagnostics: [] },
      }
    case 'saveStarted':
      return { ...state, persistence: 'saving' }
    case 'saveSucceeded':
      if (action.shader.id !== state.selectedId) {
        return { ...state, persistence: 'idle', locals: replaceLocal(state.locals, action.shader) }
      }
      if (action.draftRevision === state.draftRevision) {
        return selectedState({ ...state, persistence: 'idle', locals: replaceLocal(state.locals, action.shader) }, action.shader)
      }
      return {
        ...state,
        persistence: 'idle',
        locals: replaceLocal(state.locals, action.shader),
        savedSnapshot: cloneShader(action.shader),
        dirty: dirtyComparedTo(state.draft, action.shader),
      }
    case 'deleteSucceeded': {
      const withoutDeleted = state.locals.filter((shader) => shader.id !== action.id)
      if (action.id !== state.selectedId || action.fallback === undefined) {
        return { ...state, locals: withoutDeleted }
      }
      return selectedState({ ...state, locals: withoutDeleted }, action.fallback)
    }
    case 'modelLoadStarted':
      return {
        ...state,
        modelLoad: { status: 'loading', fileName: action.fileName },
        animations: { clipNames: [], playing: false },
      }
    case 'modelLoadSucceeded':
      return {
        ...state,
        modelLoad: { status: 'loaded', name: action.info.name, meshCount: action.info.meshCount },
        animations: {
          clipNames: [...action.info.animationClips],
          selectedClip: action.info.animationClips[0],
          playing: action.info.animationClips.length > 0,
        },
      }
    case 'animationsChanged':
      return { ...state, animations: { ...state.animations, selectedClip: action.selectedClip, playing: action.playing } }
    case 'operationFailed':
      return {
        ...state,
        persistence: action.scope === 'save' ? 'idle' : state.persistence,
        modelLoad: action.scope === 'model' ? { status: 'error', message: action.message } : state.modelLoad,
        notices: appendNotice(state, { kind: 'error', scope: action.scope, message: action.message }),
      }
    case 'clearNotices':
      return { ...state, notices: [] }
  }
}
