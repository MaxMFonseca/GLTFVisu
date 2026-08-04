import { describe, expect, it } from 'vitest'
import type { FloatParameter } from './parameters'
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

describe('validateUniformName', () => {
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
})

describe('validateParameterDefinitions', () => {
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
})
