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
  | { type: 'compileStarted'; generation: number }
  | { type: 'compileFinished'; generation: number; result: CompileResult }
  | { type: 'schemaInvalid'; errors: readonly ParameterDefinitionValidationError[] }
  | { type: 'saveStarted' }
  | { type: 'saveSucceeded'; shader: ShaderDefinition }
  | { type: 'deleteSucceeded'; id: string; fallback: ShaderDefinition }
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

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'hydrateSucceeded':
      return { ...state, hydration: 'ready', locals: action.locals.map(cloneShader) }
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
      return { ...state, draft: { ...state.draft, name: action.name }, dirty: { ...state.dirty, name: true } }
    case 'editSource':
      if (state.draft.origin === 'builtin') return state
      return {
        ...state,
        draft: { ...state.draft, fragmentSource: action.source },
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
        dirty: { ...state.dirty, values: true },
      }
    case 'portraitCaptured':
      if (state.draft.origin === 'builtin') return state
      return { ...state, draft: { ...state.draft, portrait: action.portrait }, dirty: { ...state.dirty, portrait: true } }
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
        compile: { ...state.compile, status: 'schema-invalid', diagnostics: [] },
      }
    case 'saveStarted':
      return { ...state, persistence: 'saving' }
    case 'saveSucceeded':
      return selectedState({ ...state, persistence: 'idle', locals: replaceLocal(state.locals, action.shader) }, action.shader)
    case 'deleteSucceeded':
      return selectedState({ ...state, locals: state.locals.filter((shader) => shader.id !== action.id) }, action.fallback)
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
