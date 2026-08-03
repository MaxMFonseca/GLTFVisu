export type ShaderParameterValue = number | string | boolean

interface ParameterBase {
  id: string
  uniformName: string
  label: string
}

export interface FloatParameter extends ParameterBase {
  type: 'float'
  min: number
  max: number
  step: number
  defaultValue: number
}

export interface IntegerParameter extends ParameterBase {
  type: 'integer'
  min: number
  max: number
  step: number
  defaultValue: number
}

export interface ColorParameter extends ParameterBase {
  type: 'color'
  defaultValue: string
}

export interface BooleanParameter extends ParameterBase {
  type: 'boolean'
  defaultValue: boolean
}

export type ShaderParameterDefinition =
  | FloatParameter
  | IntegerParameter
  | ColorParameter
  | BooleanParameter

const HEX_COLOR = /^#?[0-9a-fA-F]{6}$/

function fallbackNumber(definition: FloatParameter | IntegerParameter): number {
  if (Number.isFinite(definition.defaultValue)) return definition.defaultValue
  if (Number.isFinite(definition.min)) return definition.min
  if (Number.isFinite(definition.max)) return definition.max
  return 0
}

function normalizeNumber(
  definition: FloatParameter | IntegerParameter,
  value: ShaderParameterValue,
): number {
  const candidate = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN
  const numericValue = Number.isFinite(candidate) ? candidate : fallbackNumber(definition)
  const lowerBound = Number.isFinite(definition.min) ? definition.min : Number.NEGATIVE_INFINITY
  const upperBound = Number.isFinite(definition.max) ? definition.max : Number.POSITIVE_INFINITY
  const clamped = Math.min(Math.max(numericValue, lowerBound), upperBound)

  return definition.type === 'integer' ? Math.round(clamped) : clamped
}

function normalizeColor(value: ShaderParameterValue, fallback: string): string {
  const color = typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback
  return HEX_COLOR.test(color) ? `#${color.replace('#', '').toLowerCase()}` : '#000000'
}

/** Returns an independent, renderer-neutral value for a parameter definition. */
export function createDefaultValue(definition: ShaderParameterDefinition): ShaderParameterValue {
  return normalizeParameterValue(definition, definition.defaultValue)
}

/** Normalizes an external parameter value without changing the supplied definition or value. */
export function normalizeParameterValue(
  definition: ShaderParameterDefinition,
  value: ShaderParameterValue,
): ShaderParameterValue {
  switch (definition.type) {
    case 'float':
    case 'integer':
      return normalizeNumber(definition, value)
    case 'color':
      return normalizeColor(value, definition.defaultValue)
    case 'boolean':
      return typeof value === 'boolean' ? value : definition.defaultValue
  }
}
