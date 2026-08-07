import { Color, Vector2, Vector3 } from 'three'
import type { ShaderParameterDefinition, ShaderParameterValue } from '../../domain/parameters'
import { createDefaultValue, normalizeParameterValue } from '../../domain/parameters'
import { validateParameterDefinitions } from '../../domain/uniformValidation'

export type ShaderUniformValue = number | boolean | Color | Vector2 | Vector3
export interface ShaderUniform {
  value: ShaderUniformValue
}
export type ShaderUniforms = Record<string, ShaderUniform>

function assertValidDefinitions(definitions: readonly ShaderParameterDefinition[]): void {
  const errors = validateParameterDefinitions(definitions)
  if (errors.length > 0) throw new Error('Invalid shader parameter definitions')
}

function toUniformValue(
  definition: ShaderParameterDefinition,
  value: ShaderParameterValue,
): number | boolean | Color {
  const normalized = normalizeParameterValue(definition, value)
  return definition.type === 'color' ? new Color(normalized as string) : normalized as number | boolean
}

/** Creates stable uniform containers. Parameter values are keyed by parameter id. */
export function createUniforms(
  definitions: readonly ShaderParameterDefinition[],
  values: Readonly<Record<string, ShaderParameterValue | undefined>>,
): ShaderUniforms {
  assertValidDefinitions(definitions)

  const uniforms = Object.create(null) as ShaderUniforms
  uniforms.uTime = { value: 0 }
  uniforms.uResolution = { value: new Vector2() }
  uniforms.uCameraPosition = { value: new Vector3() }

  for (const definition of definitions) {
    const value = values[definition.id] ?? createDefaultValue(definition)
    uniforms[definition.uniformName] = { value: toUniformValue(definition, value) }
  }

  return uniforms
}

/** Updates the value held by an existing uniform without replacing its container. */
export function updateUniformValue(
  uniforms: ShaderUniforms,
  definition: ShaderParameterDefinition,
  value: ShaderParameterValue,
): void {
  const uniform = uniforms[definition.uniformName]
  if (uniform === undefined) throw new Error(`Unknown uniform: ${definition.uniformName}`)

  const normalized = normalizeParameterValue(definition, value)
  if (definition.type === 'color') {
    if (uniform.value instanceof Color) {
      uniform.value.set(normalized as string)
    } else {
      uniform.value = new Color(normalized as string)
    }
    return
  }

  uniform.value = normalized as number | boolean
}
