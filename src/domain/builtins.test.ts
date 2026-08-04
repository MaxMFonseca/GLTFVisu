import { describe, expect, it } from 'vitest'
import { BUILTIN_SHADERS } from './builtins'
import { validateParameterDefinitions } from './uniformValidation'

describe('BUILTIN_SHADERS', () => {
  it('ships six immutable valid shader definitions with bundled portraits', () => {
    expect(BUILTIN_SHADERS).toHaveLength(6)
    expect(Object.isFrozen(BUILTIN_SHADERS)).toBe(true)

    for (const shader of BUILTIN_SHADERS) {
      expect(shader.origin).toBe('builtin')
      expect(shader.portrait).toMatchObject({ kind: 'bundled' })
      expect(Object.isFrozen(shader.portrait)).toBe(true)
      expect(Object.isFrozen(shader.parameters)).toBe(true)
      expect(shader.parameters.every(Object.isFrozen)).toBe(true)
      expect(shader.fragmentSource).toContain('void main()')
      expect(shader.fragmentSource).toContain('outColor')
      expect(shader.fragmentSource).not.toMatch(/uniform\s|\bout\s+vec4\s+outColor/)
      expect(validateParameterDefinitions(shader.parameters)).toEqual([])
    }
  })

  it('exercises the documented built-in parameter types', () => {
    const byName = Object.fromEntries(BUILTIN_SHADERS.map((shader) => [shader.name, shader]))
    expect(byName.Fresnel.parameters.map((parameter) => parameter.type)).toEqual(['float', 'color'])
    expect(byName.Toon.parameters.map((parameter) => parameter.type)).toEqual(['integer', 'color', 'color'])
    expect(byName['Rim Light'].parameters.map((parameter) => parameter.type)).toEqual(['float', 'float', 'color'])
  })
})
