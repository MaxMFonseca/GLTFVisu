import { describe, expect, it } from 'vitest'
import type { ColorParameter, FloatParameter } from './parameters'
import { PROFILE_CONTRACT_IDENTIFIERS, parseMaterialInputProfile } from './materialInput'
import { validateParameterDefinitions, validateUniformName } from './uniformValidation'

const floatParam = (uniformName: string, overrides: Partial<FloatParameter> = {}): FloatParameter => ({
  id: `parameter-${uniformName}`,
  uniformName,
  label: uniformName,
  type: 'float',
  min: 0,
  max: 1,
  step: 0.1,
  defaultValue: 0.5,
  ...overrides,
})

const colorParam = (defaultValue: string): ColorParameter => ({
  id: 'parameter-uTint',
  uniformName: 'uTint',
  label: 'Tint',
  type: 'color',
  defaultValue,
})

describe('validateUniformName', () => {
  it.each([
    ['none', 'none'],
    ['GLTF surface', 'gltf-surface'],
    ['GLTF PBR', 'gltf-pbr'],
  ] as const)('parses the %s material input profile', (_label, value) => {
    expect(parseMaterialInputProfile(value)).toBe(value)
  })

  it.each([undefined, 'gltf-physical', 2])('rejects invalid material input profiles', (value) => {
    expect(() => parseMaterialInputProfile(value)).toThrow('Invalid material input profile')
  })

  it('accepts a valid GLSL identifier', () => {
    expect(validateUniformName('uRoughness', [])).toEqual({ valid: true })
  })

  it('rejects identifiers that begin with a number', () => {
    expect(validateUniformName('3color', [])).toEqual({
      valid: false,
      reason: 'Invalid GLSL identifier',
    })
  })

  it('rejects GLSL ES keywords', () => {
    expect(validateUniformName('uniform', [])).toEqual({
      valid: false,
      reason: 'Reserved GLSL keyword',
    })
  })

  it('rejects application uniforms', () => {
    expect(validateUniformName('uTime', [])).toEqual({
      valid: false,
      reason: 'Reserved application uniform',
    })
  })

  it.each(['vUv', 'vWorldPosition', 'vWorldNormal', 'outColor'])(
    'rejects stable shader contract identifier %s',
    (uniformName) => {
      expect(validateUniformName(uniformName, [])).toEqual({
        valid: false,
        reason: 'Reserved shader contract identifier',
      })
    },
  )

  it.each(PROFILE_CONTRACT_IDENTIFIERS)(
    'rejects the application-owned profile identifier %s',
    (uniformName) => {
      expect(validateUniformName(uniformName, [])).toEqual({
        valid: false,
        reason: 'Reserved profile contract identifier',
      })
    },
  )

  it.each([
    ['surface helper', 'sampleGltfBaseColor'],
    ['surface varying', 'vGltfUv1'],
    ['surface UV define', 'USE_UV1'],
    ['PBR tangent varying', 'vGltfWorldTangent'],
    ['PBR tangent define', 'USE_TANGENT'],
    ['PBR environment type define', 'ENVMAP_TYPE_CUBE_UV'],
    ['PBR environment width define', 'CUBEUV_TEXEL_WIDTH'],
    ['PBR environment height define', 'CUBEUV_TEXEL_HEIGHT'],
    ['PBR environment mip define', 'CUBEUV_MAX_MIP'],
  ])('rejects the injected %s %s before shader compilation', (_label, uniformName) => {
    expect(validateUniformName(uniformName, [])).toEqual({
      valid: false,
      reason: 'Reserved profile contract identifier',
    })
  })

  it.each(['gl_custom', 'u__value', '__proto__'])(
    'rejects GLSL-reserved identifier pattern %s',
    (uniformName) => {
      expect(validateUniformName(uniformName, [])).toEqual({
        valid: false,
        reason: 'Reserved GLSL identifier',
      })
    },
  )
})

describe('validateParameterDefinitions', () => {
  it('rejects blank display labels', () => {
    expect(validateParameterDefinitions([floatParam('uGain', { label: '   ' })])).toContainEqual(
      expect.objectContaining({ field: 'label', code: 'required' }),
    )
  })

  it('reports duplicate uniform names', () => {
    expect(validateParameterDefinitions([floatParam('uBand'), floatParam('uBand')])).toContainEqual(
      expect.objectContaining({ field: 'uniformName', code: 'duplicate' }),
    )
  })

  it('reports invalid numeric limits, defaults, and steps', () => {
    const errors = validateParameterDefinitions([
      floatParam('uRange', { min: 2, max: 1 }),
      floatParam('uDefault', { defaultValue: 2 }),
      floatParam('uStep', { step: 0 }),
    ])

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ parameterId: 'parameter-uRange', field: 'min', code: 'range' }),
        expect.objectContaining({ parameterId: 'parameter-uDefault', field: 'defaultValue', code: 'range' }),
        expect.objectContaining({ parameterId: 'parameter-uStep', field: 'step', code: 'step' }),
      ]),
    )
  })

  it('rejects uppercase color defaults that are not canonical domain values', () => {
    expect(validateParameterDefinitions([colorParam('#AABBCC')])).toContainEqual(
      expect.objectContaining({ parameterId: 'parameter-uTint', field: 'defaultValue', code: 'color' }),
    )
  })
})
