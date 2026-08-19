import { Color, GLSL3, ShaderMaterial, Vector2, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { BUILTIN_SHADERS } from '../../domain/builtins'
import {
  GLTF_PBR_CONTRACT_IDENTIFIERS,
  GLTF_SURFACE_CONTRACT_IDENTIFIERS,
} from '../../domain/materialInput'
import type { ShaderParameterDefinition } from '../../domain/parameters'
import { buildFragmentShader, SHADER_CONTRACT } from './contract'
import { parseShaderDiagnostics } from './diagnostics'
import * as materialFactory from './materialFactory'
import { PBR_FRAGMENT_SOURCE } from './pbrFragment'
import { pbrProfileContract, surfaceProfileContract } from './profileContract'
import { VERTEX_SHADER } from './vertexShader'

const definitions: ShaderParameterDefinition[] = [
  { id: 'gain', type: 'float', uniformName: 'uGain', label: 'Gain', min: 0, max: 2, step: 0.1, defaultValue: 1 },
  { id: 'steps', type: 'integer', uniformName: 'uSteps', label: 'Steps', min: 1, max: 8, step: 1, defaultValue: 4 },
  { id: 'tint', type: 'color', uniformName: 'uTint', label: 'Tint', defaultValue: '#123456' },
  { id: 'enabled', type: 'boolean', uniformName: 'uEnabled', label: 'Enabled', defaultValue: true },
]

describe('buildFragmentShader', () => {
  it('exports the readonly declarations used to assemble the shader contract', () => {
    expect(SHADER_CONTRACT).toEqual({
      preamble: [
        'precision highp float;',
        'precision highp int;',
        '',
        'in vec2 vUv;',
        'in vec3 vWorldPosition;',
        'in vec3 vWorldNormal;',
        '',
        'uniform float uTime;',
        'uniform vec2 uResolution;',
        'uniform vec3 uCameraPosition;',
      ],
      output: 'out vec4 outColor;',
    })
    expect(Object.isFrozen(SHADER_CONTRACT)).toBe(true)
    expect(Object.isFrozen(SHADER_CONTRACT.preamble)).toBe(true)
  })

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
    expect(result.source.split('\n')[result.injectedLineCount - 1]).toBe('#line 1 1')
    expect(result.source.split('\n')[result.injectedLineCount]).toBe('void main() {')
    expect(result.lineMapping).toEqual({ sourceId: 1, lineOffset: 0 })
  })

  it('keeps editor diagnostics stable when Three prepends a dynamic renderer prefix', () => {
    const body = `void main() {
  missingFunction();
}`
    const built = buildFragmentShader(body, [])
    const rendererPrefix = ['#version 300 es', ...Array.from({ length: 80 }, (_, index) => `#define P${index}`)]
    const rendererSource = [...rendererPrefix, ...built.source.split('\n')]

    expect(rendererSource.indexOf('  missingFunction();') + 1).toBeGreaterThan(80)
    expect(parseShaderDiagnostics(
      "ERROR: 1:2: 'missingFunction' : no matching overloaded function",
      built.lineMapping,
    )).toEqual([
      {
        severity: 'error',
        message: "'missingFunction' : no matching overloaded function",
        editorLine: 2,
        rawLine: "ERROR: 1:2: 'missingFunction' : no matching overloaded function",
      },
    ])
  })

  it('maps remapped user diagnostics through the numeric compatibility API', () => {
    const built = buildFragmentShader(`void main() {
  missingFunction();
}`, [])
    const rawLine = "ERROR: 1:2: 'missingFunction' : no matching overloaded function"

    expect(built.injectedLineCount).toBeGreaterThan(2)
    expect(parseShaderDiagnostics(rawLine, built.injectedLineCount)).toEqual([
      {
        severity: 'error',
        message: "'missingFunction' : no matching overloaded function",
        editorLine: 2,
        rawLine,
      },
    ])
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

  it.each([
    ['gltf-surface', 'sampleGltfBaseColor'],
    ['gltf-surface', 'vGltfUv1'],
    ['gltf-surface', 'USE_UV1'],
    ['gltf-pbr', 'vGltfWorldTangent'],
    ['gltf-pbr', 'USE_TANGENT'],
    ['gltf-pbr', 'ENVMAP_TYPE_CUBE_UV'],
    ['gltf-pbr', 'CUBEUV_TEXEL_WIDTH'],
    ['gltf-pbr', 'CUBEUV_TEXEL_HEIGHT'],
    ['gltf-pbr', 'CUBEUV_MAX_MIP'],
  ] as const)(
    'rejects the %s injected identifier %s before fragment assembly',
    (profile, uniformName) => {
      const invalid: ShaderParameterDefinition[] = [{
        id: 'collision',
        type: 'float',
        uniformName,
        label: 'Collision',
        min: 0,
        max: 1,
        step: 0.1,
        defaultValue: 0,
      }]

      expect(() => buildFragmentShader('void main() {}', invalid, profile))
        .toThrow('Reserved profile contract identifier')
    },
  )

  it('injects the canonical GLTF surface contract once before the reset user source', () => {
    const toon = BUILTIN_SHADERS.find((shader) => shader.id === 'builtin-toon')
    expect(toon).toBeDefined()
    if (toon === undefined) return

    const built = buildFragmentShader(toon.fragmentSource, toon.parameters, 'gltf-surface')
    const expectedDeclarations = [
      'uniform vec3 uGltfBaseColorFactor;',
      'uniform float uGltfBaseColorOpacity;',
      'uniform sampler2D uGltfBaseColorMap;',
      'uniform bool uGltfHasBaseColorMap;',
      'uniform int uGltfBaseColorUvChannel;',
      'uniform mat3 uGltfBaseColorUvTransform;',
      'uniform float uGltfAlphaCutoff;',
    ]

    expect(surfaceProfileContract.identifiers).toBe(GLTF_SURFACE_CONTRACT_IDENTIFIERS)
    expect(surfaceProfileContract.declarations).toEqual(expectedDeclarations)
    for (const declaration of expectedDeclarations) {
      expect(built.source.split(declaration)).toHaveLength(2)
    }
    expect(built.source.split('in vec2 vGltfUv1;')).toHaveLength(2)
    expect(built.source).toContain('vec4 sampleGltfBaseColor()')
    expect(built.source).not.toContain('gltfSrgbToLinear')
    expect(built.source).not.toContain('sRGBTransferEOTF')
    expect(built.source).toContain('uGltfBaseColorOpacity * texel.a')
    expect(built.source.endsWith(toon.fragmentSource)).toBe(true)
    expect(built.source.split('\n')[built.injectedLineCount - 1]).toBe('#line 1 1')
    expect(built.source.split('\n')[built.injectedLineCount]).toBe('void main() {')
  })

  it('keeps ordinary shaders free of GLTF surface declarations', () => {
    const built = buildFragmentShader('void main() {}', [], 'none')

    for (const identifier of GLTF_SURFACE_CONTRACT_IDENTIFIERS) {
      expect(built.source).not.toContain(identifier)
    }
    expect(built.source).not.toContain('vGltfUv1')
    expect(built.source).not.toContain('sampleGltfBaseColor')
  })

  it('extends the surface contract once with the canonical GLTF PBR declarations', () => {
    const pbrDefinitions: ShaderParameterDefinition[] = [
      { id: 'base-color-tint', type: 'color', uniformName: 'uBaseColorTint', label: 'Base color tint', defaultValue: '#ffffff' },
      { id: 'use-base-color-map', type: 'boolean', uniformName: 'uUseBaseColorMap', label: 'Use base color map', defaultValue: true },
      { id: 'metallic-multiplier', type: 'float', uniformName: 'uMetallicMultiplier', label: 'Metallic multiplier', min: 0, max: 2, step: 0.01, defaultValue: 1 },
      { id: 'roughness-multiplier', type: 'float', uniformName: 'uRoughnessMultiplier', label: 'Roughness multiplier', min: 0, max: 2, step: 0.01, defaultValue: 1 },
      { id: 'use-metallic-roughness-map', type: 'boolean', uniformName: 'uUseMetallicRoughnessMap', label: 'Use metallic roughness map', defaultValue: true },
      { id: 'normal-strength', type: 'float', uniformName: 'uNormalStrength', label: 'Normal strength', min: 0, max: 2, step: 0.01, defaultValue: 1 },
      { id: 'use-normal-map', type: 'boolean', uniformName: 'uUseNormalMap', label: 'Use normal map', defaultValue: true },
      { id: 'environment-contribution', type: 'float', uniformName: 'uEnvironmentContribution', label: 'Environment contribution', min: 0, max: 4, step: 0.01, defaultValue: 1 },
    ]

    const built = buildFragmentShader(PBR_FRAGMENT_SOURCE, pbrDefinitions, 'gltf-pbr')
    const pbrOnlyDeclarations = [
      'uniform float uGltfMetallicFactor;',
      'uniform float uGltfRoughnessFactor;',
      'uniform sampler2D uGltfMetallicMap;',
      'uniform sampler2D uGltfRoughnessMap;',
      'uniform bool uGltfHasMetallicMap;',
      'uniform bool uGltfHasRoughnessMap;',
      'uniform int uGltfMetallicUvChannel;',
      'uniform int uGltfRoughnessUvChannel;',
      'uniform mat3 uGltfMetallicUvTransform;',
      'uniform mat3 uGltfRoughnessUvTransform;',
      'uniform sampler2D uGltfNormalMap;',
      'uniform bool uGltfHasNormalMap;',
      'uniform int uGltfNormalUvChannel;',
      'uniform mat3 uGltfNormalUvTransform;',
      'uniform vec2 uGltfNormalScale;',
      'uniform sampler2D uGltfOcclusionMap;',
      'uniform bool uGltfHasOcclusionMap;',
      'uniform int uGltfOcclusionUvChannel;',
      'uniform mat3 uGltfOcclusionUvTransform;',
      'uniform float uGltfOcclusionStrength;',
      'uniform sampler2D uGltfEmissiveMap;',
      'uniform bool uGltfHasEmissiveMap;',
      'uniform int uGltfEmissiveUvChannel;',
      'uniform mat3 uGltfEmissiveUvTransform;',
      'uniform vec3 uGltfEmissiveFactor;',
      'uniform float uGltfEmissiveIntensity;',
      'uniform sampler2D uEnvironmentMap;',
      'uniform mat3 uEnvironmentRotation;',
      'uniform float uEnvironmentIntensity;',
    ]

    expect(pbrProfileContract.identifiers).toBe(GLTF_PBR_CONTRACT_IDENTIFIERS)
    expect(pbrProfileContract.declarations).toEqual(pbrOnlyDeclarations)
    for (const identifier of GLTF_PBR_CONTRACT_IDENTIFIERS) {
      const declarationPattern = new RegExp(`uniform\\s+\\w+\\s+${identifier};`, 'g')
      expect(built.source.match(declarationPattern)).toHaveLength(1)
    }
    for (const declaration of surfaceProfileContract.declarations) {
      expect(built.source.split(declaration)).toHaveLength(2)
    }
    expect(built.source).toContain('#define ENVMAP_TYPE_CUBE_UV')
    expect(built.source).toContain('#include <cube_uv_reflection_fragment>')
    expect(built.source.split('uniform float uEnvironmentContribution;')).toHaveLength(2)
    expect(built.source.endsWith(PBR_FRAGMENT_SOURCE)).toBe(true)
  })

  it('keeps the editable PBR body responsible for metallic-roughness BRDF, normals, IBL, and output conversion', () => {
    expect(PBR_FRAGMENT_SOURCE).toContain('distributionGGX')
    expect(PBR_FRAGMENT_SOURCE).toContain('visibilitySmithGGXCorrelated')
    expect(PBR_FRAGMENT_SOURCE).toContain('fresnelSchlick')
    expect(PBR_FRAGMENT_SOURCE).toContain('diffuseLambert')
    expect(PBR_FRAGMENT_SOURCE).toContain('dFdx(vWorldPosition)')
    expect(PBR_FRAGMENT_SOURCE).toContain('uGltfNormalScale * uNormalStrength')
    expect(PBR_FRAGMENT_SOURCE).toMatch(/texture\(uGltfRoughnessMap,[^)]+\)\.g/)
    expect(PBR_FRAGMENT_SOURCE).toMatch(/texture\(uGltfMetallicMap,[^)]+\)\.b/)
    expect(PBR_FRAGMENT_SOURCE).toMatch(/texture\(uGltfOcclusionMap,[^)]+\)\.r/)
    expect(PBR_FRAGMENT_SOURCE).toContain('mix(1.0, sampledOcclusion, uGltfOcclusionStrength)')
    expect(PBR_FRAGMENT_SOURCE).toContain('emissive *= texture(uGltfEmissiveMap, emissiveUv).rgb')
    expect(PBR_FRAGMENT_SOURCE).toContain('uGltfEmissiveFactor * uGltfEmissiveIntensity')
    expect(PBR_FRAGMENT_SOURCE).toContain('clamp(metallic, 0.0, 1.0)')
    expect(PBR_FRAGMENT_SOURCE).toContain('clamp(roughness, 0.04, 1.0)')
    expect(PBR_FRAGMENT_SOURCE).toMatch(/textureCubeUV\(uEnvironmentMap,\s*diffuseDirection,\s*1\.0\)/)
    expect(PBR_FRAGMENT_SOURCE).toMatch(/textureCubeUV\(uEnvironmentMap,\s*specularDirection,\s*roughness\)/)
    expect(PBR_FRAGMENT_SOURCE).toContain('uEnvironmentIntensity * uEnvironmentContribution')
    expect(PBR_FRAGMENT_SOURCE).toContain('toneMapping(linearColor)')
    expect(PBR_FRAGMENT_SOURCE).toContain('linearToOutputTexel')
    expect(PBR_FRAGMENT_SOURCE).toContain('outColor =')
  })

  it('uses source tangents when available and Three-style face direction for non-flat back-face normals', () => {
    expect(VERTEX_SHADER).toContain('#ifdef USE_TANGENT')
    expect(VERTEX_SHADER).toContain('out vec4 vGltfWorldTangent;')
    expect(VERTEX_SHADER).toContain('transformedTangent')
    expect(VERTEX_SHADER).toContain('tangent.w')
    expect(PBR_FRAGMENT_SOURCE).toContain('#ifdef USE_TANGENT')
    expect(PBR_FRAGMENT_SOURCE).toContain('vGltfWorldTangent.xyz')
    expect(PBR_FRAGMENT_SOURCE).toContain('cross(unflippedNormal, tangent) * vGltfWorldTangent.w')
    expect(PBR_FRAGMENT_SOURCE).toContain('float faceDirection = gl_FrontFacing ? 1.0 : -1.0;')
    expect(PBR_FRAGMENT_SOURCE).toContain('tangentFrame[0] *= faceDirection;')
    expect(PBR_FRAGMENT_SOURCE).toContain('tangentFrame[1] *= faceDirection;')
    expect(PBR_FRAGMENT_SOURCE.indexOf('normal *= faceDirection;'))
      .toBeLessThan(PBR_FRAGMENT_SOURCE.indexOf('derivativeTangentFrame(normal, normalUv'))
    expect(PBR_FRAGMENT_SOURCE.indexOf('derivativeTangentFrame(normal, normalUv'))
      .toBeLessThan(PBR_FRAGMENT_SOURCE.indexOf('tangentFrame[0] *= faceDirection;'))
  })

  it('returns the geometric normal for zero-area UV derivatives and zero mapped vectors', () => {
    expect(PBR_FRAGMENT_SOURCE).toContain('out mat3 tangentFrame')
    expect(PBR_FRAGMENT_SOURCE).toContain('float uvDeterminant =')
    expect(PBR_FRAGMENT_SOURCE).toContain('if (!pbrFiniteLengthSquared(abs(uvDeterminant))) return false;')
    expect(PBR_FRAGMENT_SOURCE).toContain('if (!derivativeTangentFrame(normal, normalUv, tangentFrame)) return normal;')
    expect(PBR_FRAGMENT_SOURCE).toContain('if (!pbrFiniteLengthSquared(mappedLengthSquared)) return normal;')
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

  it('provides secondary GLTF UVs with the primary UV as a safe fallback', () => {
    expect(VERTEX_SHADER.split('out vec2 vGltfUv1;')).toHaveLength(2)
    expect(VERTEX_SHADER).toContain('#ifdef USE_UV1')
    expect(VERTEX_SHADER).toContain('vGltfUv1 = uv1;')
    expect(VERTEX_SHADER).toContain('vGltfUv1 = vUv;')
    expect(VERTEX_SHADER.indexOf('#include <uv_vertex>'))
      .toBeLessThan(VERTEX_SHADER.indexOf('vGltfUv1 = vUv;'))
    expect(VERTEX_SHADER.indexOf('#include <batching_vertex>'))
      .toBeLessThan(VERTEX_SHADER.indexOf('#include <morphinstance_vertex>'))
  })
})

describe('createShaderMaterial', () => {
  it('returns a GLSL 3 ShaderMaterial wired to the centralized shaders and uniforms', () => {
    const material = materialFactory.createShaderMaterial(
      'void main() { outColor = vec4(uTint, 1.0); }',
      definitions,
      {
        tint: '#abcdef',
      },
    )

    expect(material).toBeInstanceOf(ShaderMaterial)
    expect(material.glslVersion).toBe(GLSL3)
    expect(material.vertexShader).toBe(VERTEX_SHADER)
    expect(material.fragmentShader.endsWith('void main() { outColor = vec4(uTint, 1.0); }')).toBe(true)
    expect(material.uniforms.uTime.value).toBe(0)
    expect(material.uniforms.uResolution.value).toEqual(new Vector2())
    expect(material.uniforms.uCameraPosition.value).toEqual(new Vector3())
    expect(material.uniforms.uTint.value).toEqual(new Color('#abcdef'))
  })

  it('retrieves robust line mapping without exposing it through material userData', () => {
    const material = materialFactory.createShaderMaterial('void main() {}', [], {})

    expect(materialFactory.getShaderLineMapping(material)).toEqual({ sourceId: 1, lineOffset: 0 })
    expect(material.userData).not.toHaveProperty('shaderLineMapping')
  })

  it('assembles the selected material profile into the created shader', () => {
    const material = materialFactory.createShaderMaterial(
      'void main() { outColor = sampleGltfBaseColor(); }',
      [],
      {},
      'gltf-surface',
    )

    expect(material.fragmentShader).toContain('vec4 sampleGltfBaseColor()')
    expect(materialFactory.getMaterialInputProfile(material)).toBe('gltf-surface')
  })
})
