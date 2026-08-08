import {
  createDefaultValue,
  normalizeParameterValue,
  type ShaderParameterDefinition,
  type ShaderParameterValue,
} from '../domain/parameters'
import type { ShaderDefinition, ShaderPortrait } from '../domain/shader'
import type { ParameterDefinitionValidationError } from '../domain/uniformValidation'
import type { CompileResult, ModelInfo } from './ViewerPort'
import {
  cleanDirtyFields,
  cloneShader,
  initialFieldRevisions,
  type WorkspaceFieldRevisions,
  type WorkspaceNotice,
  type WorkspaceState,
} from './workspaceState'

export { hasDirtyFields } from './workspaceState'
export type { WorkspaceDirtyFields, WorkspaceFieldRevisions, WorkspaceState } from './workspaceState'

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
  | {
      type: 'saveSucceeded'
      shader: ShaderDefinition
      submittedRevisions: WorkspaceFieldRevisions
      selectionRevision: number
    }
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
    selectionRevision: 0,
    fieldRevisions: initialFieldRevisions(0),
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
  const revision = state.draftRevision + 1
  return {
    ...state,
    selectedId: shader.id,
    savedSnapshot: cloneShader(shader),
    draft: cloneShader(shader),
    draftRevision: revision,
    selectionRevision: state.selectionRevision + 1,
    fieldRevisions: initialFieldRevisions(revision),
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

function reviseFields(
  state: WorkspaceState,
  fields: readonly (keyof WorkspaceFieldRevisions)[],
): Pick<WorkspaceState, 'draftRevision' | 'fieldRevisions'> {
  const revision = state.draftRevision + 1
  const fieldRevisions = { ...state.fieldRevisions }
  for (const field of fields) fieldRevisions[field] = revision
  return { draftRevision: revision, fieldRevisions }
}

function isCompatibleValue(
  parameter: ShaderParameterDefinition,
  value: ShaderParameterValue | undefined,
): value is ShaderParameterValue {
  switch (parameter.type) {
    case 'float':
    case 'integer':
      return typeof value === 'number' && Number.isFinite(value)
    case 'color':
      return typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
  }
}

function normalizeValuesForSchema(
  parameters: readonly ShaderParameterDefinition[],
  preferred: Readonly<Record<string, ShaderParameterValue>>,
  fallback: Readonly<Record<string, ShaderParameterValue>>,
): Record<string, ShaderParameterValue> {
  const values: Record<string, ShaderParameterValue> = {}
  for (const parameter of parameters) {
    const preferredValue = preferred[parameter.id]
    const fallbackValue = fallback[parameter.id]
    values[parameter.id] = isCompatibleValue(parameter, preferredValue)
      ? normalizeParameterValue(parameter, preferredValue)
      : isCompatibleValue(parameter, fallbackValue)
        ? normalizeParameterValue(parameter, fallbackValue)
        : createDefaultValue(parameter)
  }
  return values
}

function mergeSavedDraft(
  saved: ShaderDefinition,
  current: ShaderDefinition,
  preserve: Readonly<Record<keyof WorkspaceFieldRevisions, boolean>>,
): ShaderDefinition {
  const savedCopy = cloneShader(saved)
  const currentCopy = cloneShader(current)
  const portrait = preserve.portrait ? currentCopy.portrait : savedCopy.portrait
  const parameters = preserve.schema ? currentCopy.parameters : savedCopy.parameters
  let parameterValues = preserve.values ? currentCopy.parameterValues : savedCopy.parameterValues
  if (preserve.schema !== preserve.values) {
    const adopted = preserve.schema ? currentCopy : savedCopy
    parameterValues = normalizeValuesForSchema(parameters, parameterValues, adopted.parameterValues)
  }
  const draft: ShaderDefinition = {
    ...savedCopy,
    name: preserve.name ? currentCopy.name : savedCopy.name,
    fragmentSource: preserve.source ? currentCopy.fragmentSource : savedCopy.fragmentSource,
    parameters,
    parameterValues,
  }
  if (portrait === undefined) delete draft.portrait
  else draft.portrait = portrait
  return draft
}

function reconcileSavedDraft(
  state: WorkspaceState,
  saved: ShaderDefinition,
  submitted: WorkspaceFieldRevisions,
): Pick<WorkspaceState, 'draft' | 'dirty'> {
  const editedAfterSubmit = {
    name: state.fieldRevisions.name !== submitted.name,
    source: state.fieldRevisions.source !== submitted.source,
    schema: state.fieldRevisions.schema !== submitted.schema,
    values: state.fieldRevisions.values !== submitted.values,
    portrait: state.fieldRevisions.portrait !== submitted.portrait,
  }
  return {
    draft: mergeSavedDraft(saved, state.draft, editedAfterSubmit),
    dirty: editedAfterSubmit,
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
        ...reviseFields(state, ['name']),
        draft: { ...state.draft, name: action.name },
        dirty: { ...state.dirty, name: true },
      }
    case 'editSource':
      if (state.draft.origin === 'builtin') return state
      return {
        ...state,
        ...reviseFields(state, ['source']),
        draft: { ...state.draft, fragmentSource: action.source },
        dirty: { ...state.dirty, source: true },
      }
    case 'editSchema':
      if (state.draft.origin === 'builtin') return state
      return {
        ...state,
        ...reviseFields(state, ['schema', 'values']),
        draft: {
          ...state.draft,
          parameters: action.parameters.map((parameter) => ({ ...parameter })),
          parameterValues: { ...action.parameterValues },
        },
        dirty: { ...state.dirty, schema: true, values: true },
        schemaErrors: [],
      }
    case 'editValue':
      if (state.draft.origin === 'builtin') return state
      return {
        ...state,
        ...reviseFields(state, ['values']),
        draft: {
          ...state.draft,
          parameterValues: { ...state.draft.parameterValues, [action.parameterId]: action.value },
        },
        dirty: { ...state.dirty, values: true },
      }
    case 'portraitCaptured':
      if (state.draft.origin === 'builtin') return state
      return {
        ...state,
        ...reviseFields(state, ['portrait']),
        draft: { ...state.draft, portrait: action.portrait },
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
      if (action.selectionRevision !== state.selectionRevision) {
        return {
          ...state,
          persistence: 'idle',
          locals: replaceLocal(state.locals, action.shader),
          savedSnapshot: cloneShader(action.shader),
          draft: mergeSavedDraft(action.shader, state.draft, state.dirty),
        }
      }
      return {
        ...state,
        persistence: 'idle',
        locals: replaceLocal(state.locals, action.shader),
        savedSnapshot: cloneShader(action.shader),
        ...reconcileSavedDraft(state, action.shader, action.submittedRevisions),
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
