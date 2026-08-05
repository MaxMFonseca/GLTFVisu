import { normalizeParameterValue, type ShaderParameterDefinition, type ShaderParameterValue } from './parameters'
import type { ShaderDefinition, ShaderPortrait } from './shader'
import { validateParameterDefinitions } from './uniformValidation'

export const SHADER_PACKAGE_FORMAT = 'gltf-shader-visualizer'

const PACKAGE_VERSION = 1
const PORTRAIT_MIME_TYPES = ['image/png', 'image/webp', 'image/jpeg'] as const

type PortablePortrait = {
  mimeType: (typeof PORTRAIT_MIME_TYPES)[number]
  dataUrl: string
  width?: number
  height?: number
}

type PortableShader = {
  name: string
  fragmentSource: string
  parameters: ShaderParameterDefinition[]
  parameterValues: Record<string, ShaderParameterValue>
  portrait?: ShaderPortrait
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown, message: string): string {
  if (typeof value !== 'string') throw new Error(message)
  return value
}

function readNumber(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(message)
  return value
}

function readBoolean(value: unknown, message: string): boolean {
  if (typeof value !== 'boolean') throw new Error(message)
  return value
}

function readRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(message)
  return value
}

function readPortraitMimeType(value: unknown): (typeof PORTRAIT_MIME_TYPES)[number] {
  const mimeType = readString(value, 'Invalid shader portrait')
  if (!PORTRAIT_MIME_TYPES.includes(mimeType as (typeof PORTRAIT_MIME_TYPES)[number])) {
    throw new Error('Invalid shader portrait')
  }
  return mimeType as (typeof PORTRAIT_MIME_TYPES)[number]
}

function readColor(value: unknown, message: string): string {
  const color = readString(value, message)
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error(message)
  return color.toLowerCase()
}

function readParameter(value: unknown): ShaderParameterDefinition {
  const parameter = readRecord(value, 'Invalid shader parameter definitions')
  const base = {
    id: readString(parameter.id, 'Invalid shader parameter definitions'),
    uniformName: readString(parameter.uniformName, 'Invalid shader parameter definitions'),
    label: readString(parameter.label, 'Invalid shader parameter definitions'),
  }
  const type = readString(parameter.type, 'Invalid shader parameter definitions')

  switch (type) {
    case 'float':
    case 'integer':
      return {
        ...base,
        type,
        min: readNumber(parameter.min, 'Invalid shader parameter definitions'),
        max: readNumber(parameter.max, 'Invalid shader parameter definitions'),
        step: readNumber(parameter.step, 'Invalid shader parameter definitions'),
        defaultValue: readNumber(parameter.defaultValue, 'Invalid shader parameter definitions'),
      }
    case 'color':
      return { ...base, type, defaultValue: readColor(parameter.defaultValue, 'Invalid shader parameter definitions') }
    case 'boolean':
      return { ...base, type, defaultValue: readBoolean(parameter.defaultValue, 'Invalid shader parameter definitions') }
    default:
      throw new Error('Invalid shader parameter definitions')
  }
}

function readParameters(value: unknown): ShaderParameterDefinition[] {
  if (!Array.isArray(value)) throw new Error('Invalid shader parameter definitions')
  const parameters = value.map(readParameter)
  if (validateParameterDefinitions(parameters).length > 0) {
    throw new Error('Invalid shader parameter definitions')
  }
  return parameters
}

function readParameterValue(
  definition: ShaderParameterDefinition,
  value: unknown,
): ShaderParameterValue {
  switch (definition.type) {
    case 'float':
    case 'integer':
      return normalizeParameterValue(definition, readNumber(value, 'Invalid shader parameter values'))
    case 'color':
      return normalizeParameterValue(definition, readColor(value, 'Invalid shader parameter values'))
    case 'boolean':
      return normalizeParameterValue(definition, readBoolean(value, 'Invalid shader parameter values'))
  }
}

function readParameterValues(
  value: unknown,
  parameters: readonly ShaderParameterDefinition[],
): Record<string, ShaderParameterValue> {
  const values = readRecord(value, 'Invalid shader parameter values')
  const normalized: Record<string, ShaderParameterValue> = {}
  for (const parameter of parameters) {
    normalized[parameter.id] = Object.hasOwn(values, parameter.id)
      ? readParameterValue(parameter, values[parameter.id])
      : normalizeParameterValue(parameter, parameter.defaultValue)
  }
  return normalized
}

function readPortablePortrait(value: unknown): ShaderPortrait {
  const portrait = readRecord(value, 'Invalid shader portrait')
  const mimeType = readPortraitMimeType(portrait.mimeType)
  const dataUrl = readString(portrait.dataUrl, 'Invalid shader portrait')
  if (!dataUrl.startsWith(`data:${mimeType};base64,`)) throw new Error('Invalid shader portrait')

  const width = portrait.width === undefined ? 0 : readNumber(portrait.width, 'Invalid shader portrait')
  const height = portrait.height === undefined ? 0 : readNumber(portrait.height, 'Invalid shader portrait')
  if (width < 0 || height < 0) throw new Error('Invalid shader portrait')

  return { kind: 'captured', blob: dataUrlToBlob(dataUrl, mimeType), mimeType, width, height }
}

function readPortableShader(value: unknown): PortableShader {
  const shader = readRecord(value, 'Invalid shader package')
  const parameters = readParameters(shader.parameters)
  return {
    name: readString(shader.name, 'Invalid shader package'),
    fragmentSource: readString(shader.fragmentSource, 'Invalid shader package'),
    parameters,
    parameterValues: readParameterValues(shader.parameterValues, parameters),
    ...(shader.portrait === undefined ? {} : { portrait: readPortablePortrait(shader.portrait) }),
  }
}

function dataUrlToBlob(dataUrl: string, mimeType: PortablePortrait['mimeType']): Blob {
  const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary = atob(encoded)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new Blob([bytes], { type: mimeType })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read shader portrait'))
    reader.onload = () => resolve(readString(reader.result, 'Unable to read shader portrait'))
    reader.readAsDataURL(blob)
  })
}

export async function serializeShader(shader: ShaderDefinition): Promise<string> {
  const portrait = shader.portrait?.kind === 'captured'
    ? {
        mimeType: shader.portrait.mimeType,
        dataUrl: await blobToDataUrl(shader.portrait.blob),
        width: shader.portrait.width,
        height: shader.portrait.height,
      }
    : undefined

  return JSON.stringify({
    format: SHADER_PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    shader: {
      name: shader.name,
      fragmentSource: shader.fragmentSource,
      parameters: shader.parameters,
      parameterValues: shader.parameterValues,
      ...(portrait === undefined ? {} : { portrait }),
    },
  })
}

export function parseShaderPackage(
  packageJson: string,
  idFactory: () => string,
  now: number,
): ShaderDefinition {
  let value: unknown
  try {
    value = JSON.parse(packageJson)
  } catch {
    throw new Error('Malformed shader JSON')
  }

  const envelope = readRecord(value, 'Invalid shader package')
  if (readString(envelope.format, 'Unsupported shader package format') !== SHADER_PACKAGE_FORMAT) {
    throw new Error('Unsupported shader package format')
  }
  if (readNumber(envelope.version, 'Unsupported shader package version') !== PACKAGE_VERSION) {
    throw new Error('Unsupported shader package version')
  }

  const shader = readPortableShader(envelope.shader)
  return {
    id: idFactory(),
    name: shader.name,
    fragmentSource: shader.fragmentSource,
    origin: 'local',
    ...(shader.portrait === undefined ? {} : { portrait: shader.portrait }),
    parameters: shader.parameters,
    parameterValues: shader.parameterValues,
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
  }
}
