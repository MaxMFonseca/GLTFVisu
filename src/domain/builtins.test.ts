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
  it('presents the primary material shaders first in the requested library order', () => {
    expect(BUILTIN_SHADERS.map(({ id }) => id)).toEqual([
      'builtin-pbr',
      'builtin-toon',
      'builtin-normal',
      'builtin-unlit-color',
      'builtin-uv-grid',
      'builtin-fresnel',
      'builtin-procedural-matcap',
      'builtin-rim-light',
    ])
  })

  it('ships eight immutable valid shader definitions with bundled portraits', () => {
    expect(BUILTIN_SHADERS).toHaveLength(8)
    expect(Object.isFrozen(BUILTIN_SHADERS)).toBe(true)

    for (const shader of BUILTIN_SHADERS) {
      expect(shader.origin).toBe('builtin')
      expect(shader.schemaVersion).toBe(2)
      expect(shader.materialInputProfile).toBe(
        shader.id === 'builtin-toon' || shader.id === 'builtin-unlit-color'
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
      const portraitUrl = shader.portrait?.kind === 'bundled' ? shader.portrait.url : undefined
      expect(portraitUrl).toBeDefined()
      expect(new URL(portraitUrl ?? '', 'http://localhost').pathname).toMatch(/\.png$/)
      expect(portraitUrl).not.toMatch(/^data:/)
    }
  })

  it('exercises the documented built-in parameter types', () => {
    const byName = Object.fromEntries(BUILTIN_SHADERS.map((shader) => [shader.name, shader]))
    expect(byName.Fresnel.parameters.map((parameter) => parameter.type)).toEqual(['float', 'color'])
    expect(byName.Toon.parameters.map((parameter) => parameter.type)).toEqual(['integer', 'color', 'color', 'color', 'float'])
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
        { id: 'ambient-color', uniformName: 'uAmbientColor', type: 'color', defaultValue: '#ffffff' },
        { id: 'ambient-intensity', uniformName: 'uAmbientIntensity', type: 'float', min: 0, max: 2, step: 0.01, defaultValue: 1 },
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
        'ambient-color': '#ffffff',
        'ambient-intensity': 1,
      },
    })
    expect(validateParameterDefinitions(pbr?.parameters ?? [])).toEqual([])
  })

  it('makes Unlit Color texture-aware while retaining its exact color control', () => {
    const color = BUILTIN_SHADERS.find((shader) => shader.id === 'builtin-unlit-color')

    expect(color).toMatchObject({
      name: 'Unlit Color',
      materialInputProfile: 'gltf-surface',
      schemaVersion: 2,
      portrait: { kind: 'bundled' },
      parameters: [
        { id: 'color', uniformName: 'uColor', type: 'color', defaultValue: '#7aa2f7' },
        { id: 'ambient-color', uniformName: 'uAmbientColor', type: 'color', defaultValue: '#ffffff' },
        { id: 'ambient-intensity', uniformName: 'uAmbientIntensity', type: 'float', min: 0, max: 2, step: 0.01, defaultValue: 1 },
      ],
      parameterValues: { color: '#7aa2f7', 'ambient-color': '#ffffff', 'ambient-intensity': 1 },
    })
    expect(color?.fragmentSource).toContain('vec4 albedo = sampleGltfBaseColor();')
    expect(color?.fragmentSource).toContain(
      'vec3 color = albedo.rgb * (uColor + uAmbientColor * uAmbientIntensity);',
    )
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
      { id: 'ambient-color', uniformName: 'uAmbientColor', label: 'Ambient color' },
      { id: 'ambient-intensity', uniformName: 'uAmbientIntensity', label: 'Ambient intensity' },
    ])
    expect(toon?.fragmentSource).toContain('vec4 albedo = sampleGltfBaseColor();')
    expect(toon?.fragmentSource).toContain(
      'vec3 lighting = mix(uShadowColor, uLightColor, stepped) + uAmbientColor * uAmbientIntensity;',
    )
    expect(toon?.fragmentSource).toContain(
      'if (uGltfAlphaCutoff > 0.0 && albedo.a < uGltfAlphaCutoff) discard;',
    )
    expect(toon?.parameters.find(({ id }) => id === 'ambient-intensity')?.defaultValue).toBe(1)
    expect(toon?.parameterValues['ambient-intensity']).toBe(1)
  })
})
