import type { MaterialInputProfile } from '../../domain/materialInput'
import type { ShaderParameterDefinition } from '../../domain/parameters'
import { validateParameterDefinitions } from '../../domain/uniformValidation'
import { profileContractSource } from './profileContract'

const GLSL_TYPES: Record<ShaderParameterDefinition['type'], string> = {
  float: 'float',
  integer: 'int',
  color: 'vec3',
  boolean: 'bool',
}

/** Canonical app-owned declarations shown in help and injected around user code. */
export const SHADER_CONTRACT: Readonly<{
  preamble: readonly string[]
  output: string
}> = Object.freeze({
  preamble: Object.freeze([
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
  ]),
  output: 'out vec4 outColor;',
})

export interface BuiltFragmentShader {
  source: string
  injectedLineCount: number
  lineMapping: ShaderLineMapping
}

export interface ShaderLineMapping {
  sourceId: number
  lineOffset: number
}

export const USER_SOURCE_LINE_MAPPING: Readonly<ShaderLineMapping> = Object.freeze({
  sourceId: 1,
  lineOffset: 0,
})

/** Composes the base and selected profile contracts around an editable fragment program body. */
export function buildFragmentShader(
  source: string,
  definitions: readonly ShaderParameterDefinition[],
  profile: MaterialInputProfile = 'none',
): BuiltFragmentShader {
  const errors = validateParameterDefinitions(definitions)
  if (errors.length > 0) {
    throw new Error(`Invalid shader parameter definitions: ${errors.map((error) => error.message).join(', ')}`)
  }

  const profileSource = profileContractSource(profile)
  const injectedLines = [
    ...SHADER_CONTRACT.preamble,
    ...definitions.map((definition) => `uniform ${GLSL_TYPES[definition.type]} ${definition.uniformName};`),
    ...(profileSource.length > 0 ? ['', ...profileSource.split('\n')] : []),
    '',
    SHADER_CONTRACT.output,
    '',
    `#line ${USER_SOURCE_LINE_MAPPING.lineOffset + 1} ${USER_SOURCE_LINE_MAPPING.sourceId}`,
  ]

  return {
    source: `${injectedLines.join('\n')}\n${source}`,
    injectedLineCount: injectedLines.length,
    lineMapping: USER_SOURCE_LINE_MAPPING,
  }
}
