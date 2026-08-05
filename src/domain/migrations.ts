import { normalizeParameterValue, type ShaderParameterDefinition, type ShaderParameterValue } from './parameters'
import type { ShaderDefinition, ShaderOrigin, ShaderPortrait } from './shader'
import { validateParameterDefinitions } from './uniformValidation'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(message)
  return value
}

function readString(value: unknown, message: string): string {
  if (typeof value !== 'string') throw new Error(message)
  return value
}

function readNumber(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(message)
  return value
}

function readColor(value: unknown, message: string): string {
  const color = readString(value, message)
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error(message)
  return color.toLowerCase()
}

function readParameter(value: unknown): ShaderParameterDefinition {
  const parameter = readRecord(value, 'Invalid stored shader')
  const base = {
    id: readString(parameter.id, 'Invalid stored shader'),
    uniformName: readString(parameter.uniformName, 'Invalid stored shader'),
    label: readString(parameter.label, 'Invalid stored shader'),
  }
  const type = readString(parameter.type, 'Invalid stored shader')
  if (type === 'float' || type === 'integer') {
    return {
      ...base,
      type,
      min: readNumber(parameter.min, 'Invalid stored shader'),
      max: readNumber(parameter.max, 'Invalid stored shader'),
      step: readNumber(parameter.step, 'Invalid stored shader'),
      defaultValue: readNumber(parameter.defaultValue, 'Invalid stored shader'),
    }
  }
  if (type === 'color') return { ...base, type, defaultValue: readColor(parameter.defaultValue, 'Invalid stored shader') }
  if (type === 'boolean') {
    if (typeof parameter.defaultValue !== 'boolean') throw new Error('Invalid stored shader')
    return { ...base, type, defaultValue: parameter.defaultValue }
  }
  throw new Error('Invalid stored shader')
}

function readParameters(value: unknown): ShaderParameterDefinition[] {
  if (!Array.isArray(value)) throw new Error('Invalid stored shader')
  const parameters = value.map(readParameter)
  if (validateParameterDefinitions(parameters).length > 0) throw new Error('Invalid stored shader')
  return parameters
}

function readValues(value: unknown, parameters: readonly ShaderParameterDefinition[]): Record<string, ShaderParameterValue> {
  const values = readRecord(value, 'Invalid stored shader')
  const normalized: Record<string, ShaderParameterValue> = {}
  for (const parameter of parameters) {
    const candidate = values[parameter.id]
    if (candidate === undefined) {
      normalized[parameter.id] = normalizeParameterValue(parameter, parameter.defaultValue)
      continue
    }
    switch (parameter.type) {
      case 'float':
      case 'integer':
        normalized[parameter.id] = normalizeParameterValue(parameter, readNumber(candidate, 'Invalid stored shader'))
        break
      case 'color':
        normalized[parameter.id] = normalizeParameterValue(parameter, readColor(candidate, 'Invalid stored shader'))
        break
      case 'boolean':
        if (typeof candidate !== 'boolean') throw new Error('Invalid stored shader')
        normalized[parameter.id] = normalizeParameterValue(parameter, candidate)
        break
    }
  }
  return normalized
}

function readPortrait(value: unknown): ShaderPortrait | undefined {
  if (value === undefined) return undefined
  const portrait = readRecord(value, 'Invalid stored shader')
  if (portrait.kind === 'bundled') return { kind: 'bundled', url: readString(portrait.url, 'Invalid stored shader') }
  if (portrait.kind !== 'captured' || !(portrait.blob instanceof Blob)) throw new Error('Invalid stored shader')
  const mimeType = readString(portrait.mimeType, 'Invalid stored shader')
  if (mimeType !== 'image/png' && mimeType !== 'image/webp' && mimeType !== 'image/jpeg') throw new Error('Invalid stored shader')
  return {
    kind: 'captured',
    blob: portrait.blob,
    mimeType,
    width: readNumber(portrait.width, 'Invalid stored shader'),
    height: readNumber(portrait.height, 'Invalid stored shader'),
  }
}

export function migrateStoredShader(value: unknown): ShaderDefinition {
  const stored = readRecord(value, 'Invalid stored shader')
  if (readNumber(stored.schemaVersion, 'Unsupported stored shader version') !== 1) {
    throw new Error('Unsupported stored shader version')
  }
  const origin = readString(stored.origin, 'Invalid stored shader')
  if (origin !== 'builtin' && origin !== 'local') throw new Error('Invalid stored shader')
  const parameters = readParameters(stored.parameters)

  return {
    id: readString(stored.id, 'Invalid stored shader'),
    name: readString(stored.name, 'Invalid stored shader'),
    fragmentSource: readString(stored.fragmentSource, 'Invalid stored shader'),
    origin: origin as ShaderOrigin,
    ...(stored.portrait === undefined ? {} : { portrait: readPortrait(stored.portrait) }),
    parameters,
    parameterValues: readValues(stored.parameterValues, parameters),
    ...(stored.createdAt === undefined ? {} : { createdAt: readNumber(stored.createdAt, 'Invalid stored shader') }),
    ...(stored.updatedAt === undefined ? {} : { updatedAt: readNumber(stored.updatedAt, 'Invalid stored shader') }),
    schemaVersion: 1,
  }
}
