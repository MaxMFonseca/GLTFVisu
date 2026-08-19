import type { ParameterDefinitionValidationError } from '../domain/uniformValidation'
import type { ShaderParameterValue } from '../domain/parameters'
import type { ShaderDefinition, ShaderDraft } from '../domain/shader'
import type { AnimationClipInfo, CompileDiagnostic } from './ViewerPort'
import type { EnvironmentDefinition, WorkspaceEnvironmentState } from '../domain/environment'
import type { ModelTextureSlotInfo } from '../three/modelTextures/ModelTextureRegistry'

export interface WorkspaceDirtyFields {
  name: boolean
  source: boolean
  schema: boolean
  values: boolean
  portrait: boolean
}

export interface WorkspaceFieldRevisions {
  name: number
  source: number
  schema: number
  values: number
  portrait: number
}

export interface WorkspaceCompileState {
  generation: number
  status: 'idle' | 'pending' | 'valid' | 'error' | 'schema-invalid'
  diagnostics: readonly CompileDiagnostic[]
}

export type WorkspaceModelLoadState =
  | { status: 'empty' }
  | {
      status: 'loading'
      fileName: string
      retained?: { name: string; meshCount: number; textureSlots: readonly ModelTextureSlotInfo[] }
    }
  | { status: 'loaded'; name: string; meshCount: number; textureSlots: readonly ModelTextureSlotInfo[] }
  | { status: 'error'; message: string }

export interface WorkspaceAnimationState {
  clips: readonly AnimationClipInfo[]
  selectedClipId?: string
  playing: boolean
}

export interface WorkspaceNotice {
  kind: 'info' | 'error'
  scope: 'hydrate' | 'save' | 'delete' | 'import' | 'export' | 'capture' | 'model' | 'environment'
  message: string
}

export type BuiltinParameterValues = Readonly<Record<
  string,
  Readonly<Record<string, ShaderParameterValue>>
>>

export interface WorkspaceState {
  builtins: readonly ShaderDefinition[]
  environmentCatalog: readonly EnvironmentDefinition[]
  environment: WorkspaceEnvironmentState
  environmentLoadGeneration: number
  builtinParameterValues: BuiltinParameterValues
  locals: readonly ShaderDefinition[]
  selectedId: string
  savedSnapshot: ShaderDefinition
  draft: ShaderDraft
  draftRevision: number
  selectionRevision: number
  fieldRevisions: WorkspaceFieldRevisions
  dirty: WorkspaceDirtyFields
  hydration: 'loading' | 'ready' | 'error'
  persistence: 'idle' | 'saving'
  schemaErrors: readonly ParameterDefinitionValidationError[]
  compile: WorkspaceCompileState
  modelLoad: WorkspaceModelLoadState
  animations: WorkspaceAnimationState
  notices: readonly WorkspaceNotice[]
}

export function cloneShader(shader: ShaderDefinition): ShaderDefinition {
  return {
    ...shader,
    ...(shader.portrait === undefined ? {} : {
      portrait: shader.portrait.kind === 'bundled'
        ? { ...shader.portrait }
        : { ...shader.portrait, blob: shader.portrait.blob },
    }),
    parameters: shader.parameters.map((parameter) => ({ ...parameter })),
    parameterValues: { ...shader.parameterValues },
  }
}

export function cloneShaderWithBuiltinParameterValues(
  shader: ShaderDefinition,
  builtinParameterValues: BuiltinParameterValues,
): ShaderDefinition {
  const draft = cloneShader(shader)
  if (shader.origin === 'builtin') {
    draft.parameterValues = {
      ...draft.parameterValues,
      ...builtinParameterValues[shader.id],
    }
  }
  return draft
}

export function cleanDirtyFields(): WorkspaceDirtyFields {
  return { name: false, source: false, schema: false, values: false, portrait: false }
}

export function initialFieldRevisions(revision: number): WorkspaceFieldRevisions {
  return { name: revision, source: revision, schema: revision, values: revision, portrait: revision }
}

export function hasDirtyFields(dirty: WorkspaceDirtyFields): boolean {
  return dirty.name || dirty.source || dirty.schema || dirty.values || dirty.portrait
}

export function hasLoadedModel(modelLoad: WorkspaceModelLoadState): boolean {
  return modelLoad.status === 'loaded' || modelLoad.status === 'loading' && modelLoad.retained !== undefined
}
