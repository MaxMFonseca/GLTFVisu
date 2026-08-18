import type { ShaderParameterDefinition, ShaderParameterValue } from './parameters'
import type { MaterialInputProfile } from './materialInput'

export const SHADER_SCHEMA_VERSION = 2 as const

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
  materialInputProfile: MaterialInputProfile
  portrait?: ShaderPortrait
  parameters: ShaderParameterDefinition[]
  parameterValues: Record<string, ShaderParameterValue>
  createdAt?: number
  updatedAt?: number
  schemaVersion: typeof SHADER_SCHEMA_VERSION
}

export type ShaderDraft = ShaderDefinition
