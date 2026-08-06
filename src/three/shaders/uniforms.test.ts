import { Color, Vector2, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { ShaderParameterDefinition } from '../../domain/parameters'
import { createUniforms, updateUniformValue } from './uniforms'

const definitions: ShaderParameterDefinition[] = [
  { id: 'gain', type: 'float', uniformName: 'uGain', label: 'Gain', min: 0, max: 2, step: 0.1, defaultValue: 1 },
  { id: 'steps', type: 'integer', uniformName: 'uSteps', label: 'Steps', min: 1, max: 8, step: 1, defaultValue: 4 },
  { id: 'tint', type: 'color', uniformName: 'uTint', label: 'Tint', defaultValue: '#123456' },
  { id: 'enabled', type: 'boolean', uniformName: 'uEnabled', label: 'Enabled', defaultValue: true },
]

describe('createUniforms', () => {
  it('creates app and schema uniforms with normalized Three-compatible values', () => {
    const uniforms = createUniforms(definitions, {
      gain: '1.5',
      steps: 6.6,
      tint: '#ABCDEF',
      enabled: false,
    })

    expect(uniforms.uTime.value).toBe(0)
    expect(uniforms.uResolution.value).toEqual(new Vector2())
    expect(uniforms.uCameraPosition.value).toEqual(new Vector3())
    expect(uniforms.uGain.value).toBe(1.5)
    expect(uniforms.uSteps.value).toBe(7)
    expect(uniforms.uTint.value).toEqual(new Color('#abcdef'))
    expect(uniforms.uEnabled.value).toBe(false)
  })

  it('uses normalized defaults when values are absent or invalid', () => {
    const uniforms = createUniforms(definitions, { gain: 'nope', tint: 'transparent' })

    expect(uniforms.uGain.value).toBe(1)
    expect(uniforms.uSteps.value).toBe(4)
    expect(uniforms.uTint.value).toEqual(new Color('#123456'))
    expect(uniforms.uEnabled.value).toBe(true)
  })

  it('uses a null-prototype map and rejects prototype-sensitive uniform names', () => {
    const uniforms = createUniforms(definitions, {})
    const prototypeDefinition: ShaderParameterDefinition = {
      id: 'prototype',
      type: 'float',
      uniformName: '__proto__',
      label: 'Prototype',
      min: 0,
      max: 1,
      step: 0.1,
      defaultValue: 0,
    }

    expect(Object.getPrototypeOf(uniforms)).toBeNull()
    expect(() => createUniforms([prototypeDefinition], {})).toThrow('Invalid shader parameter definitions')
  })
})

describe('updateUniformValue', () => {
  it('mutates scalar values without replacing their uniform objects', () => {
    const uniforms = createUniforms(definitions, {})
    const floatUniform = uniforms.uGain
    const integerUniform = uniforms.uSteps
    const booleanUniform = uniforms.uEnabled

    updateUniformValue(uniforms, definitions[0], 1.75)
    updateUniformValue(uniforms, definitions[1], 5.8)
    updateUniformValue(uniforms, definitions[3], false)

    expect(uniforms.uGain).toBe(floatUniform)
    expect(uniforms.uSteps).toBe(integerUniform)
    expect(uniforms.uEnabled).toBe(booleanUniform)
    expect(floatUniform.value).toBe(1.75)
    expect(integerUniform.value).toBe(6)
    expect(booleanUniform.value).toBe(false)
  })

  it('mutates a color value without replacing the uniform or Color objects', () => {
    const uniforms = createUniforms(definitions, {})
    const colorUniform = uniforms.uTint
    const color = colorUniform.value

    updateUniformValue(uniforms, definitions[2], '#fedcba')

    expect(uniforms.uTint).toBe(colorUniform)
    expect(colorUniform.value).toBe(color)
    expect(colorUniform.value).toEqual(new Color('#fedcba'))
  })

  it('does not add a missing uniform during an update', () => {
    const uniforms = createUniforms([], {})

    expect(() => updateUniformValue(uniforms, definitions[0], 1)).toThrow('Unknown uniform: uGain')
    expect(uniforms).not.toHaveProperty('uGain')
  })
})
