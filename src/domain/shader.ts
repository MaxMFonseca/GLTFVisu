import type { ShaderParameterDefinition, ShaderParameterValue } from './parameters'

export type ShaderOrigin = 'builtin' | 'local'

export type ShaderPortrait =
  | { kind: 'bundled'; url: string }
  | {
      kind: 'captured'
      blob: Blob
      mimeType: 'image/webp' | 'image/png' | 'image/jpeg'
      width: number
      height: number
    }

export interface ShaderDefinition {
  id: string
  name: string
  fragmentSource: string
  origin: ShaderOrigin
  portrait?: ShaderPortrait
  parameters: ShaderParameterDefinition[]
  parameterValues: Record<string, ShaderParameterValue>
  createdAt?: number
  updatedAt?: number
  schemaVersion: 1
}

export type ShaderDraft = ShaderDefinition
