import { describe, expect, it } from 'vitest'
import { parseShaderPackage, serializeShader, SHADER_PACKAGE_FORMAT } from './importExport'
import type { ShaderDefinition } from './shader'

const shader: ShaderDefinition = {
  id: 'original-id',
  name: 'Soft glow',
  fragmentSource: 'void main() { outColor = vec4(1.0); }',
  origin: 'local',
  parameters: [
    { id: 'gain', type: 'float', uniformName: 'uGain', label: 'Gain', min: 0, max: 2, step: 0.1, defaultValue: 1 },
    { id: 'tint', type: 'color', uniformName: 'uTint', label: 'Tint', defaultValue: '#aabbcc' },
  ],
  parameterValues: { gain: 1.5, tint: '#112233' },
  createdAt: 10,
  updatedAt: 20,
  schemaVersion: 2,
  materialInputProfile: 'none',
}

const idFactory = () => 'fresh-id'

function envelope(overrides: Record<string, unknown> = {}, version = 2): Record<string, unknown> {
  return {
    format: SHADER_PACKAGE_FORMAT,
    version,
    shader: {
      name: shader.name,
      fragmentSource: shader.fragmentSource,
      ...(version === 2 ? { materialInputProfile: shader.materialInputProfile } : {}),
      parameters: shader.parameters,
      parameterValues: shader.parameterValues,
      ...overrides,
    },
  }
}

describe('serializeShader', () => {
  it('writes a versioned portable package without local identity fields', async () => {
    const parsed = JSON.parse(await serializeShader(shader))

    expect(parsed).toMatchObject({
      format: SHADER_PACKAGE_FORMAT,
      version: 2,
      shader: { name: 'Soft glow', fragmentSource: shader.fragmentSource },
    })
    expect(parsed.shader).not.toHaveProperty('id')
    expect(parsed.shader).not.toHaveProperty('origin')
    expect(parsed.shader).not.toHaveProperty('createdAt')
  })

  it('writes the material input profile in v2 packages', async () => {
    await expect(serializeShader({ ...shader, materialInputProfile: 'gltf-surface' }))
      .resolves.toContain('"materialInputProfile":"gltf-surface"')
  })

  it('round-trips a portrait as a portable data URL', async () => {
    const withPortrait: ShaderDefinition = {
      ...shader,
      portrait: {
        kind: 'captured',
        blob: new Blob(['portrait'], { type: 'image/png' }),
        mimeType: 'image/png',
        width: 120,
        height: 80,
      },
    }

    const packageJson = await serializeShader(withPortrait)
    const imported = parseShaderPackage(packageJson, idFactory, 1234)

    expect(imported.portrait).toMatchObject({ kind: 'captured', mimeType: 'image/png' })
    expect(imported.portrait?.kind === 'captured' && imported.portrait.blob.type).toBe('image/png')
  })
})

describe('parseShaderPackage', () => {
  it('assigns a fresh local identity and timestamp to an imported package', () => {
    const imported = parseShaderPackage(JSON.stringify(envelope()), idFactory, 1234)

    expect(imported).toMatchObject({
      id: 'fresh-id',
      origin: 'local',
      createdAt: 1234,
      updatedAt: 1234,
      schemaVersion: 2,
      materialInputProfile: 'none',
      name: 'Soft glow',
      parameterValues: { gain: 1.5, tint: '#112233' },
    })
  })

  it('accepts a package without a portrait', () => {
    expect(parseShaderPackage(JSON.stringify(envelope()), idFactory, 1234).portrait).toBeUndefined()
  })

  it('migrates a v1 package to the none material input profile', () => {
    const imported = parseShaderPackage(JSON.stringify(envelope({}, 1)), idFactory, 10)

    expect(imported).toMatchObject({ schemaVersion: 2, materialInputProfile: 'none' })
  })

  it('rejects malformed JSON', () => {
    expect(() => parseShaderPackage('{', idFactory, 1234)).toThrow('Malformed shader JSON')
  })

  it('rejects a package with a wrong format or unsupported version', () => {
    expect(() => parseShaderPackage(JSON.stringify(envelope({})).replace(SHADER_PACKAGE_FORMAT, 'other'), idFactory, 1234)).toThrow('Unsupported shader package format')
    expect(() => parseShaderPackage(JSON.stringify({ ...envelope(), version: 3 }), idFactory, 1234)).toThrow('Unsupported shader package version')
  })

  it.each([
    ['a missing v2 material input profile', envelope({ materialInputProfile: undefined })],
    ['an unsupported v2 material input profile', envelope({ materialInputProfile: 'gltf-physical' })],
  ])('rejects %s', (_case, value) => {
    expect(() => parseShaderPackage(JSON.stringify(value), idFactory, 1234)).toThrow('Invalid material input profile')
  })

  it('rejects an unknown v2 shader key', () => {
    expect(() => parseShaderPackage(JSON.stringify(envelope({ extra: true })), idFactory, 1234)).toThrow('Invalid shader package')
  })

  it('rejects invalid parameter metadata', () => {
    const invalid = envelope({
      parameters: [{ id: 'bad', type: 'float', uniformName: 'uBad', label: 'Bad', min: 2, max: 1, step: 0.1, defaultValue: 1 }],
    })
    expect(() => parseShaderPackage(JSON.stringify(invalid), idFactory, 1234)).toThrow('Invalid shader parameter definitions')
  })

  it.each([
    ['envelope', { ...envelope(), extra: true }],
    ['shader', envelope({ extra: true })],
    ['parameter', envelope({ parameters: [{ ...shader.parameters[0], extra: true }, shader.parameters[1]] })],
    ['portrait', envelope({ portrait: { mimeType: 'image/png', dataUrl: 'data:image/png;base64,eA==', extra: true } })],
  ])('rejects unknown keys in the %s object', (_location, value) => {
    expect(() => parseShaderPackage(JSON.stringify(value), idFactory, 1234)).toThrow('Invalid shader package')
  })

  it('rejects reserved and duplicate imported uniforms', () => {
    const reserved = envelope({
      parameters: [{ id: 'time', type: 'float', uniformName: 'uTime', label: 'Time', min: 0, max: 1, step: 0.1, defaultValue: 0 }],
    })
    expect(() => parseShaderPackage(JSON.stringify(reserved), idFactory, 1234)).toThrow('Invalid shader parameter definitions')

    const duplicate = envelope({
      parameters: [
        { id: 'one', type: 'boolean', uniformName: 'uFlag', label: 'One', defaultValue: true },
        { id: 'two', type: 'boolean', uniformName: 'uFlag', label: 'Two', defaultValue: false },
      ],
    })
    expect(() => parseShaderPackage(JSON.stringify(duplicate), idFactory, 1234)).toThrow('Invalid shader parameter definitions')
  })

  it.each([
    ['a missing value', { gain: 1.5, bands: 2, tint: '#112233' }],
    ['an extra value', { gain: 1.5, bands: 2, tint: '#112233', enabled: true, extra: 1 }],
    ['a numeric string', { gain: '1.5', bands: 2, tint: '#112233', enabled: true }],
    ['an out-of-range float', { gain: 3, bands: 2, tint: '#112233', enabled: true }],
    ['a fractional integer', { gain: 1.5, bands: 2.5, tint: '#112233', enabled: true }],
    ['an out-of-range integer', { gain: 1.5, bands: 9, tint: '#112233', enabled: true }],
    ['a noncanonical color', { gain: 1.5, bands: 2, tint: '#AABBCC', enabled: true }],
    ['an invalid color', { gain: 1.5, bands: 2, tint: 'blue', enabled: true }],
    ['a non-boolean', { gain: 1.5, bands: 2, tint: '#112233', enabled: 1 }],
  ])('rejects parameter values containing %s', (_case, parameterValues) => {
    const invalid = envelope({
      parameters: [
        { id: 'gain', type: 'float', uniformName: 'uGain', label: 'Gain', min: 0, max: 2, step: 0.1, defaultValue: 1 },
        { id: 'bands', type: 'integer', uniformName: 'uBands', label: 'Bands', min: 1, max: 8, step: 1, defaultValue: 3 },
        { id: 'tint', type: 'color', uniformName: 'uTint', label: 'Tint', defaultValue: '#aabbcc' },
        { id: 'enabled', type: 'boolean', uniformName: 'uEnabled', label: 'Enabled', defaultValue: true },
      ],
      parameterValues,
    })

    expect(() => parseShaderPackage(JSON.stringify(invalid), idFactory, 1234)).toThrow('Invalid shader parameter values')
  })

  it('rejects portraits with an unsupported MIME type or data URL', () => {
    const unsupported = envelope({ portrait: { mimeType: 'image/gif', dataUrl: 'data:image/gif;base64,R0lG' } })
    expect(() => parseShaderPackage(JSON.stringify(unsupported), idFactory, 1234)).toThrow('Invalid shader portrait')

    const mismatched = envelope({ portrait: { mimeType: 'image/png', dataUrl: 'data:image/webp;base64,UklGRg==' } })
    expect(() => parseShaderPackage(JSON.stringify(mismatched), idFactory, 1234)).toThrow('Invalid shader portrait')
  })
})
