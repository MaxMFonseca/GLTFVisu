import {
  createDefaultValue,
  normalizeParameterValue,
  type ShaderParameterDefinition,
  type ShaderParameterValue,
} from '../domain/parameters'
import type { ShaderDefinition, ShaderPortrait } from '../domain/shader'
import type { ParameterDefinitionValidationError } from '../domain/uniformValidation'
import type { ModelTextureSlotInfo } from '../three/modelTextures/ModelTextureRegistry'
import type { CompileResult, ModelInfo } from './ViewerPort'
import {
  DEFAULT_ENVIRONMENT_DISPLAY_SETTINGS,
  type EnvironmentDefinition,
  type EnvironmentDisplaySettings,
  type EnvironmentLoadSource,
} from '../domain/environment'
import {
  cleanDirtyFields,
  cloneShader,
  cloneShaderWithBuiltinParameterValues,
  initialFieldRevisions,
  type BuiltinParameterValues,
  type WorkspaceFieldRevisions,
  type WorkspaceNotice,
  type WorkspaceState,
} from './workspaceState'

export { hasDirtyFields } from './workspaceState'
export type { BuiltinParameterValues, WorkspaceDirtyFields, WorkspaceFieldRevisions, WorkspaceState } from './workspaceState'

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
  | { type: 'modelLoadSucceeded'; generation: number; info: ModelInfo }
  | { type: 'modelTexturesChanged'; generation: number; textureSlots: readonly ModelTextureSlotInfo[] }
  | { type: 'environmentLoadStarted'; generation: number; label: string }
  | { type: 'environmentLoadSucceeded'; generation: number; source: EnvironmentLoadSource }
  | { type: 'environmentLoadFailed'; generation: number; message: string }
  | { type: 'environmentSettingsChanged'; settings: EnvironmentDisplaySettings }
  | { type: 'animationsChanged'; selectedClipId?: string; playing: boolean }
  | { type: 'operationSucceeded'; scope: WorkspaceNotice['scope']; message: string }
  | { type: 'operationFailed'; scope: WorkspaceNotice['scope']; message: string }
  | { type: 'clearNotices' }

export function createInitialWorkspaceState(
  builtins: readonly ShaderDefinition[],
  environmentCatalog: readonly EnvironmentDefinition[] = [],
): WorkspaceState {
  const first = builtins[0]
  if (first === undefined) throw new Error('Workspace requires at least one built-in shader')
  return {
    builtins,
    environmentCatalog,
    environment: { status: 'idle', settings: { ...DEFAULT_ENVIRONMENT_DISPLAY_SETTINGS } },
    environmentLoadGeneration: 0,
    builtinParameterValues: createBuiltinParameterValues(builtins),
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
    modelGeneration: 0,
    modelLoad: { status: 'empty' },
    animations: { clips: [], playing: false },
    notices: [],
  }
}

function createBuiltinParameterValues(builtins: readonly ShaderDefinition[]): BuiltinParameterValues {
  const values: Record<string, Readonly<Record<string, ShaderParameterValue>>> = {}
  for (const builtin of builtins) values[builtin.id] = { ...builtin.parameterValues }
  return values
}

function selectedState(state: WorkspaceState, shader: ShaderDefinition): WorkspaceState {
  const revision = state.draftRevision + 1
  const draft = cloneShaderWithBuiltinParameterValues(shader, state.builtinParameterValues)
  return {
    ...state,
    selectedId: shader.id,
    savedSnapshot: cloneShader(shader),
    draft,
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

function cloneTextureSlots(textureSlots: readonly ModelTextureSlotInfo[]): readonly ModelTextureSlotInfo[] {
  return textureSlots.map((slot) => ({ ...slot }))
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
      if (state.draft.origin === 'builtin') {
        const parameterValues = { ...state.draft.parameterValues, [action.parameterId]: action.value }
        return {
          ...state,
          builtinParameterValues: {
            ...state.builtinParameterValues,
            [state.draft.id]: { ...parameterValues },
          },
          draft: { ...state.draft, parameterValues },
        }
      }
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
      {
        const retained = state.modelLoad.status === 'loaded'
          ? {
              name: state.modelLoad.name,
              meshCount: state.modelLoad.meshCount,
              textureSlots: state.modelLoad.textureSlots,
            }
          : state.modelLoad.status === 'loading'
            ? state.modelLoad.retained
            : undefined
      return {
        ...state,
        modelLoad: {
          status: 'loading',
          fileName: action.fileName,
          ...(retained === undefined ? {} : { retained }),
        },
      }
      }
    case 'modelLoadSucceeded':
      return {
        ...state,
        modelGeneration: action.generation,
        modelLoad: {
          status: 'loaded',
          name: action.info.name,
          meshCount: action.info.meshCount,
          textureSlots: cloneTextureSlots(action.info.textureSlots),
        },
        animations: {
          clips: action.info.animationClips.map((clip) => ({ ...clip })),
          selectedClipId: action.info.animationClips[0]?.id,
          playing: false,
        },
      }
    case 'environmentLoadStarted':
      return {
        ...state,
        environmentLoadGeneration: action.generation,
        environment: {
          status: 'loading',
          ...(state.environment.activeSource === undefined ? {} : { activeSource: state.environment.activeSource }),
          pendingLabel: action.label,
          settings: state.environment.settings,
        },
      }
    case 'modelTexturesChanged':
      if (action.generation !== state.modelGeneration) return state
      if (state.modelLoad.status === 'loaded') {
        return {
          ...state,
          modelLoad: {
            ...state.modelLoad,
            textureSlots: cloneTextureSlots(action.textureSlots),
          },
        }
      }
      if (state.modelLoad.status === 'loading' && state.modelLoad.retained !== undefined) {
        return {
          ...state,
          modelLoad: {
            ...state.modelLoad,
            retained: {
              ...state.modelLoad.retained,
              textureSlots: cloneTextureSlots(action.textureSlots),
            },
          },
        }
      }
      return state
    case 'environmentLoadSucceeded':
      if (action.generation !== state.environmentLoadGeneration) return state
      return {
        ...state,
        environment: {
          status: 'ready',
          activeSource: action.source,
          settings: state.environment.settings,
        },
      }
    case 'environmentLoadFailed':
      if (action.generation !== state.environmentLoadGeneration) return state
      return {
        ...state,
        environment: state.environment.activeSource === undefined
          ? { status: 'error', error: action.message, settings: state.environment.settings }
          : {
              status: 'error',
              activeSource: state.environment.activeSource,
              error: action.message,
              settings: state.environment.settings,
            },
        notices: appendNotice(state, { kind: 'error', scope: 'environment', message: action.message }),
      }
    case 'environmentSettingsChanged':
      return { ...state, environment: { ...state.environment, settings: action.settings } }
    case 'animationsChanged':
      return { ...state, animations: { ...state.animations, selectedClipId: action.selectedClipId, playing: action.playing } }
    case 'operationSucceeded':
      return {
        ...state,
        notices: appendNotice(state, { kind: 'info', scope: action.scope, message: action.message }),
      }
    case 'operationFailed':
      return {
        ...state,
        persistence: action.scope === 'save' ? 'idle' : state.persistence,
        modelLoad: action.scope === 'model' && state.modelLoad.status === 'loading'
          ? state.modelLoad.retained !== undefined
            ? { status: 'loaded', ...state.modelLoad.retained }
            : { status: 'error', message: action.message }
          : state.modelLoad,
        notices: appendNotice(state, { kind: 'error', scope: action.scope, message: action.message }),
      }
    case 'clearNotices':
      return { ...state, notices: [] }
  }
}
