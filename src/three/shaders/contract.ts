import type { ShaderParameterDefinition } from '../../domain/parameters'
import { validateParameterDefinitions } from '../../domain/uniformValidation'

const GLSL_TYPES: Record<ShaderParameterDefinition['type'], string> = {
  float: 'float',
  integer: 'int',
  color: 'vec3',
  boolean: 'bool',
}

const STABLE_CONTRACT = [
  'precision highp float;',
  'precision highp int;',
  '',
  'in vec2 vUv;',
  'in vec3 vWorldPosition;',
  'in vec3 vWorldNormal;',
  '',
  'uniform float uTime;',
  'uniform vec2 uResolution;',
  'uniform vec3 uCameraPosition;',
] as const

export interface BuiltFragmentShader {
  source: string
  injectedLineCount: number
}

/** Composes the app-owned GLSL contract around an editable fragment program body. */
export function buildFragmentShader(
  source: string,
  definitions: readonly ShaderParameterDefinition[],
): BuiltFragmentShader {
  const errors = validateParameterDefinitions(definitions)
  if (errors.length > 0) {
    throw new Error(`Invalid shader parameter definitions: ${errors.map((error) => error.message).join(', ')}`)
  }

  const injectedLines = [
    ...STABLE_CONTRACT,
    ...definitions.map((definition) => `uniform ${GLSL_TYPES[definition.type]} ${definition.uniformName};`),
    '',
    'out vec4 outColor;',
    '',
  ]

  return {
    source: `${injectedLines.join('\n')}\n${source}`,
    injectedLineCount: injectedLines.length,
  }
}
