import type { ParameterDefinitionValidationError } from '../domain/uniformValidation'
import type { ShaderDefinition, ShaderDraft } from '../domain/shader'
import type { CompileDiagnostic } from '../three/ViewerEngine'

export interface WorkspaceDirtyFields {
  name: boolean
  source: boolean
  schema: boolean
  values: boolean
  portrait: boolean
}

export interface WorkspaceCompileState {
  generation: number
  status: 'idle' | 'pending' | 'valid' | 'error' | 'schema-invalid'
  diagnostics: readonly CompileDiagnostic[]
}

export type WorkspaceModelLoadState =
  | { status: 'empty' }
  | { status: 'loading'; fileName: string }
  | { status: 'loaded'; name: string; meshCount: number }
  | { status: 'error'; message: string }

export interface WorkspaceAnimationState {
  clipNames: readonly string[]
  selectedClip?: string
  playing: boolean
}

export interface WorkspaceNotice {
  kind: 'info' | 'error'
  scope: 'hydrate' | 'save' | 'delete' | 'import' | 'export' | 'capture' | 'model'
  message: string
}

export interface WorkspaceState {
  builtins: readonly ShaderDefinition[]
  locals: readonly ShaderDefinition[]
  selectedId: string
  savedSnapshot: ShaderDefinition
  draft: ShaderDraft
  draftRevision: number
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

export function cleanDirtyFields(): WorkspaceDirtyFields {
  return { name: false, source: false, schema: false, values: false, portrait: false }
}

export function hasDirtyFields(dirty: WorkspaceDirtyFields): boolean {
  return dirty.name || dirty.source || dirty.schema || dirty.values || dirty.portrait
}
