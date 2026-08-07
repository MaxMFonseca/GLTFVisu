import { Color, GLSL3, Vector2, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { ShaderParameterDefinition } from '../../domain/parameters'
import { buildFragmentShader } from './contract'
import { createShaderMaterial } from './materialFactory'
import { VERTEX_SHADER } from './vertexShader'

const definitions: ShaderParameterDefinition[] = [
  { id: 'gain', type: 'float', uniformName: 'uGain', label: 'Gain', min: 0, max: 2, step: 0.1, defaultValue: 1 },
  { id: 'steps', type: 'integer', uniformName: 'uSteps', label: 'Steps', min: 1, max: 8, step: 1, defaultValue: 4 },
  { id: 'tint', type: 'color', uniformName: 'uTint', label: 'Tint', defaultValue: '#123456' },
  { id: 'enabled', type: 'boolean', uniformName: 'uEnabled', label: 'Enabled', defaultValue: true },
]

describe('buildFragmentShader', () => {
  it('declares the stable contract once and appends the editable program body unchanged', () => {
    const body = `void main() {
  outColor = vec4(vUv, uTime, 1.0);
}`

    const result = buildFragmentShader(body, definitions)

    const declarations = [
      'in vec2 vUv;',
      'in vec3 vWorldPosition;',
      'in vec3 vWorldNormal;',
      'uniform float uTime;',
      'uniform vec2 uResolution;',
      'uniform vec3 uCameraPosition;',
      'out vec4 outColor;',
    ]
    for (const declaration of declarations) {
      expect(result.source.split(declaration)).toHaveLength(2)
    }
    expect(result.source).not.toContain('#version')
    expect(result.source.endsWith(body)).toBe(true)
    expect(result.source.split('\n')[result.injectedLineCount]).toBe('void main() {')
  })

  it('declares custom uniforms in schema order with their GLSL types', () => {
    const { source } = buildFragmentShader('void main() {}', definitions)

    const customDeclarations = [
      'uniform float uGain;',
      'uniform int uSteps;',
      'uniform vec3 uTint;',
      'uniform bool uEnabled;',
    ]
    expect(customDeclarations.map((declaration) => source.indexOf(declaration))).toEqual([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ])
    for (let index = 1; index < customDeclarations.length; index += 1) {
      expect(source.indexOf(customDeclarations[index])).toBeGreaterThan(source.indexOf(customDeclarations[index - 1]))
    }
  })

  it('rejects invalid schema uniforms before injecting GLSL', () => {
    const invalid: ShaderParameterDefinition[] = [
      { id: 'bad', type: 'float', uniformName: '3bad', label: 'Bad', min: 0, max: 1, step: 0.1, defaultValue: 0 },
    ]

    expect(() => buildFragmentShader('void main() {}', invalid)).toThrow('Invalid shader parameter definitions')
  })
})

describe('VERTEX_SHADER', () => {
  it('uses the current Three chunks for UVs, morphs, skinning, projection, and normal transforms', () => {
    const chunks = [
      '#include <uv_pars_vertex>',
      '#include <morphtarget_pars_vertex>',
      '#include <skinning_pars_vertex>',
      '#include <uv_vertex>',
      '#include <morphinstance_vertex>',
      '#include <morphnormal_vertex>',
      '#include <skinbase_vertex>',
      '#include <skinnormal_vertex>',
      '#include <defaultnormal_vertex>',
      '#include <morphtarget_vertex>',
      '#include <skinning_vertex>',
      '#include <project_vertex>',
    ]
    for (const chunk of chunks) expect(VERTEX_SHADER).toContain(chunk)

    expect(VERTEX_SHADER.indexOf('#include <morphinstance_vertex>'))
      .toBeLessThan(VERTEX_SHADER.indexOf('#include <morphnormal_vertex>'))
    expect(VERTEX_SHADER.indexOf('#include <skinning_vertex>'))
      .toBeLessThan(VERTEX_SHADER.indexOf('vWorldPosition = worldPosition.xyz;'))
    expect(VERTEX_SHADER).toContain('normalize( inverseTransformDirection( transformedNormal, viewMatrix ) )')
  })
})

describe('createShaderMaterial', () => {
  it('creates a GLSL 3 ShaderMaterial wired to the centralized shaders and uniforms', () => {
    const material = createShaderMaterial('void main() { outColor = vec4(uTint, 1.0); }', definitions, {
      tint: '#abcdef',
    })

    expect(material.glslVersion).toBe(GLSL3)
    expect(material.vertexShader).toBe(VERTEX_SHADER)
    expect(material.fragmentShader.endsWith('void main() { outColor = vec4(uTint, 1.0); }')).toBe(true)
    expect(material.uniforms.uTime.value).toBe(0)
    expect(material.uniforms.uResolution.value).toEqual(new Vector2())
    expect(material.uniforms.uCameraPosition.value).toEqual(new Vector3())
    expect(material.uniforms.uTint.value).toEqual(new Color('#abcdef'))
  })
})
