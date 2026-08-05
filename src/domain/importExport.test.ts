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
  schemaVersion: 1,
}

const idFactory = () => 'fresh-id'

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: SHADER_PACKAGE_FORMAT,
    version: 1,
    shader: {
      id: 'untrusted-id',
      origin: 'builtin',
      name: shader.name,
      fragmentSource: shader.fragmentSource,
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
      version: 1,
      shader: { name: 'Soft glow', fragmentSource: shader.fragmentSource },
    })
    expect(parsed.shader).not.toHaveProperty('id')
    expect(parsed.shader).not.toHaveProperty('origin')
    expect(parsed.shader).not.toHaveProperty('createdAt')
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
      schemaVersion: 1,
      name: 'Soft glow',
      parameterValues: { gain: 1.5, tint: '#112233' },
    })
  })

  it('accepts a package without a portrait', () => {
    expect(parseShaderPackage(JSON.stringify(envelope()), idFactory, 1234).portrait).toBeUndefined()
  })

  it('rejects malformed JSON', () => {
    expect(() => parseShaderPackage('{', idFactory, 1234)).toThrow('Malformed shader JSON')
  })

  it('rejects a package with a wrong format or unsupported version', () => {
    expect(() => parseShaderPackage(JSON.stringify(envelope({})).replace(SHADER_PACKAGE_FORMAT, 'other'), idFactory, 1234)).toThrow('Unsupported shader package format')
    expect(() => parseShaderPackage(JSON.stringify({ ...envelope(), version: 2 }), idFactory, 1234)).toThrow('Unsupported shader package version')
  })

  it('ignores unknown fields but rejects invalid parameter metadata', () => {
    const accepted = parseShaderPackage(JSON.stringify(envelope({ futureField: true })), idFactory, 1234)
    expect(accepted.name).toBe('Soft glow')

    const invalid = envelope({
      parameters: [{ id: 'bad', type: 'float', uniformName: 'uBad', label: 'Bad', min: 2, max: 1, step: 0.1, defaultValue: 1 }],
    })
    expect(() => parseShaderPackage(JSON.stringify(invalid), idFactory, 1234)).toThrow('Invalid shader parameter definitions')
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

  it('rejects portraits with an unsupported MIME type or data URL', () => {
    const unsupported = envelope({ portrait: { mimeType: 'image/gif', dataUrl: 'data:image/gif;base64,R0lG' } })
    expect(() => parseShaderPackage(JSON.stringify(unsupported), idFactory, 1234)).toThrow('Invalid shader portrait')

    const mismatched = envelope({ portrait: { mimeType: 'image/png', dataUrl: 'data:image/webp;base64,UklGRg==' } })
    expect(() => parseShaderPackage(JSON.stringify(mismatched), idFactory, 1234)).toThrow('Invalid shader portrait')
  })
})
