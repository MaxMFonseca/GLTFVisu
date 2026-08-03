import { describe, expect, it } from 'vitest'
import {
  createDefaultValue,
  normalizeParameterValue,
  type BooleanParameter,
  type ColorParameter,
  type FloatParameter,
  type IntegerParameter,
} from './parameters'

const floatParam: FloatParameter = {
  id: 'float-roughness',
  uniformName: 'uRoughness',
  label: 'Roughness',
  type: 'float',
  min: 0,
  max: 1,
  step: 0.1,
  defaultValue: 0.4,
}

const integerParam: IntegerParameter = {
  id: 'int-bands',
  uniformName: 'uBands',
  label: 'Bands',
  type: 'integer',
  min: 1,
  max: 8,
  step: 1,
  defaultValue: 4,
}

const colorParam: ColorParameter = {
  id: 'color-tint',
  uniformName: 'uTint',
  label: 'Tint',
  type: 'color',
  defaultValue: '#aabbcc',
}

const booleanParam: BooleanParameter = {
  id: 'bool-enabled',
  uniformName: 'uEnabled',
  label: 'Enabled',
  type: 'boolean',
  defaultValue: true,
}

describe('createDefaultValue', () => {
  it('returns the definition default without mutating it', () => {
    expect(createDefaultValue(floatParam)).toBe(0.4)
    expect(createDefaultValue(colorParam)).toBe('#aabbcc')
    expect(createDefaultValue(booleanParam)).toBe(true)
  })
})

describe('normalizeParameterValue', () => {
  it('clamps float values to their configured range', () => {
    expect(normalizeParameterValue(floatParam, 1.5)).toBe(1)
  })

  it('rounds and clamps integer values', () => {
    expect(normalizeParameterValue(integerParam, 3.7)).toBe(4)
    expect(normalizeParameterValue(integerParam, 99)).toBe(8)
  })

  it('normalizes six-digit color hex values', () => {
    expect(normalizeParameterValue(colorParam, '#AbC123')).toBe('#abc123')
    expect(normalizeParameterValue(colorParam, 'abc123')).toBe('#abc123')
  })

  it('preserves boolean values', () => {
    expect(normalizeParameterValue(booleanParam, false)).toBe(false)
  })
})
