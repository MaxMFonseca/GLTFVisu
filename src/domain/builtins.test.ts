import { describe, expect, it } from 'vitest'
import { BUILTIN_SHADERS } from './builtins'
import { BUILTIN_ENVIRONMENTS } from './environments'
import { validateParameterDefinitions } from './uniformValidation'
import { PBR_FRAGMENT_SOURCE } from '../three/shaders/pbrFragment'

describe('BUILTIN_ENVIRONMENTS', () => {
  it('ships the four ordered offline CC0 environments with Vite asset URLs', () => {
    expect(BUILTIN_ENVIRONMENTS.map(({ id }) => id)).toEqual([
      'rogland-clear-night',
      'urban-street-01',
      'goegap',
      'poly-haven-studio',
    ])
    expect(BUILTIN_ENVIRONMENTS.every((item) => item.license === 'CC0-1.0')).toBe(true)
    expect(BUILTIN_ENVIRONMENTS.every((item) => item.hdrUrl.endsWith('.hdr'))).toBe(true)
    expect(Object.isFrozen(BUILTIN_ENVIRONMENTS)).toBe(true)
    expect(BUILTIN_ENVIRONMENTS.every(Object.isFrozen)).toBe(true)
  })
})

describe('BUILTIN_SHADERS', () => {
  it('ships eight immutable valid shader definitions with bundled portraits', () => {
    expect(BUILTIN_SHADERS).toHaveLength(8)
    expect(Object.isFrozen(BUILTIN_SHADERS)).toBe(true)

    for (const shader of BUILTIN_SHADERS) {
      expect(shader.origin).toBe('builtin')
      expect(shader.schemaVersion).toBe(2)
      expect(shader.materialInputProfile).toBe(
        shader.id === 'builtin-toon'
          ? 'gltf-surface'
          : shader.id === 'builtin-pbr'
            ? 'gltf-pbr'
            : 'none',
      )
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

  it('registers PBR through the common GLTF PBR source and exact runtime controls', () => {
    const pbr = BUILTIN_SHADERS.find((shader) => shader.id === 'builtin-pbr')

    expect(pbr).toMatchObject({
      name: 'PBR',
      materialInputProfile: 'gltf-pbr',
      schemaVersion: 2,
      fragmentSource: PBR_FRAGMENT_SOURCE,
      portrait: { kind: 'bundled' },
      parameters: [
        { id: 'base-color-tint', uniformName: 'uBaseColorTint', type: 'color', defaultValue: '#ffffff' },
        { id: 'use-base-color-map', uniformName: 'uUseBaseColorMap', type: 'boolean', defaultValue: true },
        { id: 'metallic-multiplier', uniformName: 'uMetallicMultiplier', type: 'float', min: 0, max: 2, step: 0.01, defaultValue: 1 },
        { id: 'roughness-multiplier', uniformName: 'uRoughnessMultiplier', type: 'float', min: 0, max: 2, step: 0.01, defaultValue: 1 },
        { id: 'use-metallic-roughness-map', uniformName: 'uUseMetallicRoughnessMap', type: 'boolean', defaultValue: true },
        { id: 'normal-strength', uniformName: 'uNormalStrength', type: 'float', min: 0, max: 2, step: 0.01, defaultValue: 1 },
        { id: 'use-normal-map', uniformName: 'uUseNormalMap', type: 'boolean', defaultValue: true },
        { id: 'environment-contribution', uniformName: 'uEnvironmentContribution', type: 'float', min: 0, max: 4, step: 0.01, defaultValue: 1 },
      ],
      parameterValues: {
        'base-color-tint': '#ffffff',
        'use-base-color-map': true,
        'metallic-multiplier': 1,
        'roughness-multiplier': 1,
        'use-metallic-roughness-map': true,
        'normal-strength': 1,
        'use-normal-map': true,
        'environment-contribution': 1,
      },
    })
    expect(validateParameterDefinitions(pbr?.parameters ?? [])).toEqual([])
  })

  it('registers Unlit Color with one exact color control and no material profile', () => {
    const color = BUILTIN_SHADERS.find((shader) => shader.id === 'builtin-unlit-color')

    expect(color).toMatchObject({
      name: 'Unlit Color',
      materialInputProfile: 'none',
      schemaVersion: 2,
      portrait: { kind: 'bundled' },
      parameters: [
        { id: 'color', uniformName: 'uColor', type: 'color', defaultValue: '#7aa2f7' },
      ],
      parameterValues: { color: '#7aa2f7' },
    })
    expect(color?.fragmentSource).toBe(`void main() {
  outColor = vec4(uColor, 1.0);
}`)
    expect(validateParameterDefinitions(color?.parameters ?? [])).toEqual([])
  })

  it('makes Toon texture-aware without changing its package-compatible parameter identifiers', () => {
    const toon = BUILTIN_SHADERS.find((shader) => shader.id === 'builtin-toon')

    expect(toon).toBeDefined()
    expect(toon?.materialInputProfile).toBe('gltf-surface')
    expect(toon?.parameters.map(({ id, uniformName, label }) => ({ id, uniformName, label }))).toEqual([
      { id: 'bands', uniformName: 'uBands', label: 'Bands' },
      { id: 'shadow-color', uniformName: 'uShadowColor', label: 'Shadow tint' },
      { id: 'light-color', uniformName: 'uLightColor', label: 'Light tint' },
    ])
    expect(toon?.fragmentSource).toContain('vec4 albedo = sampleGltfBaseColor();')
    expect(toon?.fragmentSource).toContain(
      'outColor = vec4(albedo.rgb * mix(uShadowColor, uLightColor, stepped), albedo.a);',
    )
    expect(toon?.fragmentSource).toContain(
      'if (uGltfAlphaCutoff > 0.0 && albedo.a < uGltfAlphaCutoff) discard;',
    )
  })
})
