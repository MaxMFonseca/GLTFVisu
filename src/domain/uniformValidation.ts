import type { ShaderParameterDefinition } from './parameters'

export const APP_UNIFORMS = ['uTime', 'uResolution', 'uCameraPosition'] as const

export const GLSL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** GLSL ES 3.00 keywords plus reserved words inherited from earlier GLSL profiles. */
export const GLSL_ES_KEYWORDS = new Set([
  'attribute',
  'const',
  'uniform',
  'varying',
  'layout',
  'centroid',
  'flat',
  'smooth',
  'noperspective',
  'break',
  'continue',
  'do',
  'for',
  'while',
  'switch',
  'case',
  'default',
  'if',
  'else',
  'in',
  'out',
  'inout',
  'float',
  'double',
  'int',
  'void',
  'bool',
  'true',
  'false',
  'invariant',
  'discard',
  'return',
  'mat2',
  'mat3',
  'mat4',
  'mat2x2',
  'mat2x3',
  'mat2x4',
  'mat3x2',
  'mat3x3',
  'mat3x4',
  'mat4x2',
  'mat4x3',
  'mat4x4',
  'vec2',
  'vec3',
  'vec4',
  'ivec2',
  'ivec3',
  'ivec4',
  'bvec2',
  'bvec3',
  'bvec4',
  'dvec2',
  'dvec3',
  'dvec4',
  'uint',
  'uvec2',
  'uvec3',
  'uvec4',
  'lowp',
  'mediump',
  'highp',
  'precision',
  'sampler2D',
  'sampler3D',
  'samplerCube',
  'sampler2DShadow',
  'samplerCubeShadow',
  'sampler2DArray',
  'sampler2DArrayShadow',
  'isampler2D',
  'isampler3D',
  'isamplerCube',
  'isampler2DArray',
  'usampler2D',
  'usampler3D',
  'usamplerCube',
  'usampler2DArray',
  'sampler2DMS',
  'isampler2DMS',
  'usampler2DMS',
  'sampler2DMSArray',
  'isampler2DMSArray',
  'usampler2DMSArray',
  'struct',
  'asm',
  'class',
  'union',
  'enum',
  'typedef',
  'template',
  'this',
  'packed',
  'goto',
  'inline',
  'noinline',
  'public',
  'static',
  'extern',
  'external',
  'interface',
  'long',
  'short',
  'half',
  'fixed',
  'unsigned',
  'superp',
  'input',
  'output',
  'hvec2',
  'hvec3',
  'hvec4',
  'fvec2',
  'fvec3',
  'fvec4',
  'sampler1D',
  'sampler1DShadow',
  'sampler2DRect',
  'sampler2DRectShadow',
  'sampler1DArray',
  'sampler1DArrayShadow',
  'isampler1D',
  'isampler1DArray',
  'isampler2DRect',
  'usampler1D',
  'usampler1DArray',
  'usampler2DRect',
  'filter',
  'image1D',
  'image2D',
  'image3D',
  'image2DRect',
  'imageCube',
  'imageBuffer',
  'image1DArray',
  'image2DArray',
  'imageCubeArray',
  'iimage1D',
  'iimage2D',
  'iimage3D',
  'iimage2DRect',
  'iimageCube',
  'iimageBuffer',
  'iimage1DArray',
  'iimage2DArray',
  'iimageCubeArray',
  'uimage1D',
  'uimage2D',
  'uimage3D',
  'uimage2DRect',
  'uimageCube',
  'uimageBuffer',
  'uimage1DArray',
  'uimage2DArray',
  'uimageCubeArray',
  'sizeof',
  'cast',
  'namespace',
  'using',
  'row_major',
])

export type UniformNameValidation = { valid: true } | { valid: false; reason: string }

export interface ParameterDefinitionValidationError {
  parameterId: string
  field: 'uniformName' | 'min' | 'max' | 'step' | 'defaultValue'
  code: 'identifier' | 'glsl-keyword' | 'application-uniform' | 'duplicate' | 'range' | 'step' | 'integer' | 'color'
  message: string
}

export function validateUniformName(
  uniformName: string,
  existingUniformNames: readonly string[],
): UniformNameValidation {
  if (!GLSL_IDENTIFIER.test(uniformName)) {
    return { valid: false, reason: 'Invalid GLSL identifier' }
  }
  if (GLSL_ES_KEYWORDS.has(uniformName)) {
    return { valid: false, reason: 'Reserved GLSL keyword' }
  }
  if (APP_UNIFORMS.includes(uniformName as (typeof APP_UNIFORMS)[number])) {
    return { valid: false, reason: 'Reserved application uniform' }
  }
  if (existingUniformNames.includes(uniformName)) {
    return { valid: false, reason: 'Duplicate uniform name' }
  }
  return { valid: true }
}

function error(
  parameterId: string,
  field: ParameterDefinitionValidationError['field'],
  code: ParameterDefinitionValidationError['code'],
  message: string,
): ParameterDefinitionValidationError {
  return { parameterId, field, code, message }
}

function validateNumericParameter(
  parameter: Extract<ShaderParameterDefinition, { type: 'float' | 'integer' }>,
): ParameterDefinitionValidationError[] {
  const errors: ParameterDefinitionValidationError[] = []
  const numbers: Array<readonly [ParameterDefinitionValidationError['field'], number]> = [
    ['min', parameter.min],
    ['max', parameter.max],
    ['step', parameter.step],
    ['defaultValue', parameter.defaultValue],
  ]

  for (const [field, value] of numbers) {
    if (!Number.isFinite(value)) errors.push(error(parameter.id, field, 'range', 'Must be a finite number'))
  }
  if (parameter.min > parameter.max) {
    errors.push(error(parameter.id, 'min', 'range', 'Minimum cannot exceed maximum'))
  }
  if (parameter.step <= 0) errors.push(error(parameter.id, 'step', 'step', 'Step must be greater than zero'))
  if (parameter.defaultValue < parameter.min || parameter.defaultValue > parameter.max) {
    errors.push(error(parameter.id, 'defaultValue', 'range', 'Default must be within the configured range'))
  }
  if (parameter.type === 'integer') {
    for (const [field, value] of numbers) {
      if (!Number.isInteger(value)) errors.push(error(parameter.id, field, 'integer', 'Must be an integer'))
    }
  }
  return errors
}

export function validateParameterDefinitions(
  definitions: readonly ShaderParameterDefinition[],
): ParameterDefinitionValidationError[] {
  const uniformCounts = new Map<string, number>()
  for (const definition of definitions) {
    uniformCounts.set(definition.uniformName, (uniformCounts.get(definition.uniformName) ?? 0) + 1)
  }

  const errors: ParameterDefinitionValidationError[] = []
  for (const definition of definitions) {
    const nameResult = validateUniformName(definition.uniformName, [])
    if (!nameResult.valid) {
      const code = nameResult.reason === 'Invalid GLSL identifier'
        ? 'identifier'
        : nameResult.reason === 'Reserved GLSL keyword'
          ? 'glsl-keyword'
          : 'application-uniform'
      errors.push(error(definition.id, 'uniformName', code, nameResult.reason))
    }
    if ((uniformCounts.get(definition.uniformName) ?? 0) > 1) {
      errors.push(error(definition.id, 'uniformName', 'duplicate', 'Uniform names must be unique'))
    }

    if (definition.type === 'float' || definition.type === 'integer') {
      errors.push(...validateNumericParameter(definition))
    }
    if (definition.type === 'color' && !/^#[0-9a-fA-F]{6}$/.test(definition.defaultValue)) {
      errors.push(error(definition.id, 'defaultValue', 'color', 'Color must be a six-digit hex value'))
    }
  }
  return errors
}
