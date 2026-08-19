import {
  BoxGeometry,
  Camera,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  ShaderMaterial,
  Texture,
  Matrix3,
  Float32BufferAttribute,
} from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { ShaderParameterDefinition } from '../domain/parameters'
import type { ShaderDraft } from '../domain/shader'
import type { CompileDiagnostic } from '../application/ViewerPort'
import { BUILTIN_SHADERS } from '../domain/builtins'
import type { MaterialInputProfile } from '../domain/materialInput'
import { createGltfSurfaceBindingOwner } from './materialBindings/GltfSurfaceBinding'
import { createGltfPbrBindingOwner, type EnvironmentShaderMaterial } from './materialBindings/GltfPbrBinding'
import type { EnvironmentBinding } from './materialBindings/types'
import { MaterialOverride } from './MaterialOverride'
import {
  ShaderCompiler,
  type RuntimeMaterialPreparer,
  type ShaderValidationRenderer,
} from './ShaderCompiler'
import { getMaterialInputProfile } from './shaders/materialFactory'
import { PBR_FRAGMENT_SOURCE } from './shaders/pbrFragment'

const gain: ShaderParameterDefinition = {
  id: 'gain',
  type: 'float',
  uniformName: 'uGain',
  label: 'Gain',
  min: 0,
  max: 2,
  step: 0.1,
  defaultValue: 1,
}

const threshold: ShaderParameterDefinition = {
  id: 'threshold',
  type: 'float',
  uniformName: 'uThreshold',
  label: 'Threshold',
  min: 0,
  max: 1,
  step: 0.01,
  defaultValue: 0.5,
}

function draft(source: string, materialInputProfile: MaterialInputProfile = 'none'): ShaderDraft {
  return {
    id: source,
    name: source,
    origin: 'local',
    fragmentSource: source,
    parameters: [gain],
    parameterValues: { gain: 1 },
    schemaVersion: 2,
    materialInputProfile,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

const unusedRenderer: ShaderValidationRenderer = {
  debug: { checkShaderErrors: true, onShaderError: null },
  render: vi.fn(),
}

function shaderMaterialsIn(root: Object3D): ShaderMaterial[] {
  const materials = new Set<ShaderMaterial>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const assignment = object.material
    for (const material of Array.isArray(assignment) ? assignment : [assignment]) {
      if (material instanceof ShaderMaterial) materials.add(material)
    }
  })
  return [...materials]
}

describe('ShaderCompiler', () => {
  it('rejects a stale generation immediately before commit', async () => {
    const validations = [deferred<CompileDiagnostic[]>(), deferred<CompileDiagnostic[]>()]
    const candidates: ShaderMaterial[] = []
    const compiler = new ShaderCompiler(unusedRenderer, {
      validate: (material) => {
        candidates.push(material)
        return validations[candidates.length - 1].promise
      },
    })
    const first = compiler.compile(draft('first'))
    const second = compiler.compile(draft('second'))
    expect(candidates).toHaveLength(2)
    const firstMaterial = candidates[0]
    const secondMaterial = candidates[1]
    const disposeStale = vi.spyOn(firstMaterial, 'dispose')

    validations[1].resolve([])
    await expect(second).resolves.toEqual({ status: 'valid', generation: 2 })
    validations[0].resolve([])
    await expect(first).resolves.toEqual({ status: 'error', generation: 1, diagnostics: [] })

    expect(compiler.material).toBe(secondMaterial)
    expect(disposeStale).toHaveBeenCalledTimes(1)
  })

  it('retains a working shader on failure and disposes it only after a later success', async () => {
    const syntaxError: CompileDiagnostic = {
      severity: 'error',
      message: 'syntax error',
      editorLine: 3,
      raw: 'ERROR: 1:3: syntax error',
    }
    const results = [[], [syntaxError], []] as CompileDiagnostic[][]
    const candidates: ShaderMaterial[] = []
    const compiler = new ShaderCompiler(unusedRenderer, {
      validate: async (material) => {
        candidates.push(material)
        return results[candidates.length - 1]
      },
    })

    await compiler.compile(draft('working'))
    const working = candidates[0]
    const disposeWorking = vi.spyOn(working, 'dispose')
    const failedPromise = compiler.compile(draft('broken'))
    const failed = candidates[1]
    const disposeFailed = vi.spyOn(failed, 'dispose')
    await expect(failedPromise).resolves.toEqual({ status: 'error', generation: 2, diagnostics: [syntaxError] })

    expect(compiler.material).toBe(working)
    expect(disposeWorking).not.toHaveBeenCalled()
    expect(failed).not.toBe(working)
    expect(disposeFailed).toHaveBeenCalledTimes(1)

    await expect(compiler.compile(draft('replacement'))).resolves.toEqual({ status: 'valid', generation: 3 })
    expect(compiler.material).toBe(candidates[2])
    expect(disposeWorking).toHaveBeenCalledTimes(1)
  })

  it('reports a committed replacement as valid when predecessor template cleanup throws', async () => {
    const candidates: ShaderMaterial[] = []
    const compiler = new ShaderCompiler(unusedRenderer, {
      validate: async (material) => {
        candidates.push(material)
        return []
      },
    })
    await compiler.compile(draft('surface template', 'gltf-surface'))
    const predecessor = compiler.material as ShaderMaterial
    let activeDuringCleanup: ShaderMaterial | undefined
    predecessor.addEventListener('dispose', () => {
      activeDuringCleanup = compiler.material
      throw new Error('predecessor template cleanup failed')
    })
    const commit = vi.fn()

    const result = await compiler.compile(draft('PBR template', 'gltf-pbr'), () => ({
      validate: () => [],
      commit,
      dispose: vi.fn(),
    }))

    expect(result).toEqual({ status: 'valid', generation: 2 })
    expect(commit).toHaveBeenCalledOnce()
    expect(activeDuringCleanup).toBe(candidates[1])
    expect(compiler.material).toBe(candidates[1])
    expect(getMaterialInputProfile(compiler.material as ShaderMaterial)).toBe('gltf-pbr')
    compiler.dispose()
  })

  it('tags candidates with the draft profile and preserves the last valid profile on failure', async () => {
    const syntaxError: CompileDiagnostic = { severity: 'error', message: 'broken profile', raw: 'broken profile' }
    const compiler = new ShaderCompiler(unusedRenderer, {
      validate: async (material) => getMaterialInputProfile(material) === 'gltf-pbr' ? [syntaxError] : [],
    })

    await expect(compiler.compile(draft('surface', 'gltf-surface')))
      .resolves.toEqual({ status: 'valid', generation: 1 })
    const working = compiler.material
    await expect(compiler.compile(draft('broken', 'gltf-pbr')))
      .resolves.toEqual({ status: 'error', generation: 2, diagnostics: [syntaxError] })

    expect(compiler.material).toBe(working)
    expect(getMaterialInputProfile(compiler.material as ShaderMaterial)).toBe('gltf-surface')
    expect(compiler.material?.userData).not.toHaveProperty('materialInputProfile')
  })

  it('updates a live uniform without invoking validation again', async () => {
    const validate = vi.fn(async () => [])
    const compiler = new ShaderCompiler(unusedRenderer, { validate })
    await compiler.compile(draft('working'))
    const uniform = compiler.material?.uniforms.uGain

    compiler.updateParameter(gain, 1.75)

    expect(validate).toHaveBeenCalledTimes(1)
    expect(compiler.material?.uniforms.uGain).toBe(uniform)
    expect(uniform?.value).toBe(1.75)
  })

  it('applies a parameter update to a candidate that is still compiling', async () => {
    const validation = deferred<CompileDiagnostic[]>()
    let candidate: ShaderMaterial | undefined
    const compiler = new ShaderCompiler(unusedRenderer, {
      validate: (material) => {
        candidate = material
        return validation.promise
      },
    })

    const compiling = compiler.compile(draft('pending'))
    compiler.updateParameter(gain, 1.75)

    expect(candidate?.uniforms.uGain.value).toBe(1.75)
    validation.resolve([])
    await expect(compiling).resolves.toEqual({ status: 'valid', generation: 1 })
    expect(compiler.material?.uniforms.uGain.value).toBe(1.75)
  })

  it('retains an immediate value edit for a newly added uniform until its candidate exists', async () => {
    const compiler = new ShaderCompiler(unusedRenderer, { validate: async () => [] })
    await compiler.compile(draft('working'))

    expect(() => compiler.updateParameter(threshold, 0.8)).not.toThrow()
    const nextDraft = {
      ...draft('working'),
      fragmentSource: 'with threshold',
      parameters: [gain, threshold],
    }
    await compiler.compile(nextDraft)

    expect(compiler.material?.uniforms.uThreshold.value).toBe(0.8)
  })

  it('retains a renamed uniform value after a failed candidate compile', async () => {
    const syntaxError: CompileDiagnostic = { severity: 'error', message: 'broken', raw: 'broken' }
    const compiler = new ShaderCompiler(unusedRenderer, {
      validate: async (material) => material.name === 'broken' ? [syntaxError] : [],
      createMaterial: (source, parameters, values) => {
        const material = new ShaderMaterial({
          uniforms: Object.fromEntries(parameters.map((parameter) => [
            parameter.uniformName,
            { value: values?.[parameter.id] ?? parameter.defaultValue },
          ])),
        })
        material.name = source
        return material
      },
    })
    await compiler.compile(draft('working'))
    const renamed = { ...gain, uniformName: 'uRenamedGain' }
    await compiler.compile({
      ...draft('working'),
      fragmentSource: 'broken',
      parameters: [renamed],
    })

    expect(() => compiler.updateParameter(renamed, 1.6)).not.toThrow()
    await compiler.compile({
      ...draft('working'),
      fragmentSource: 'recovered',
      parameters: [renamed],
    })

    expect(compiler.material?.uniforms.uRenamedGain.value).toBe(1.6)
  })

  it('does not carry parameter edits into a different shader with the same uniform name', async () => {
    const compiler = new ShaderCompiler(unusedRenderer, { validate: async () => [] })
    await compiler.compile(draft('shader-a'))
    compiler.updateParameter(gain, 1.75)

    await compiler.compile({ ...draft('shader-b'), parameterValues: { gain: 0.25 } })

    expect(compiler.material?.uniforms.uGain.value).toBe(0.25)
  })

  it('captures renderer shader errors and maps user-source lines', async () => {
    const previousErrorHandler = vi.fn()
    const renderer: ShaderValidationRenderer = {
      debug: { checkShaderErrors: true, onShaderError: previousErrorHandler },
      render: vi.fn(() => {
        const fragment = {} as WebGLShader
        const gl = {
          getProgramInfoLog: () => 'link failed',
          getShaderInfoLog: (shader: WebGLShader) => shader === fragment ? 'ERROR: 1:7: syntax error' : '',
        } as unknown as WebGLRenderingContext
        renderer.debug.onShaderError?.(gl, {} as never, {} as WebGLShader, fragment)
      }),
    }
    const compiler = new ShaderCompiler(renderer)

    const result = await compiler.compile(draft('broken'))

    expect(result).toEqual({
      status: 'error',
      generation: 1,
      diagnostics: [{ severity: 'error', message: 'syntax error', editorLine: 7, raw: 'ERROR: 1:7: syntax error' }],
    })
    expect(renderer.debug.onShaderError).toBe(previousErrorHandler)
    expect(compiler.material).toBeUndefined()
  })

  it('validates real Toon source and UV0/UV1 surface variants through default compiler boundaries', async () => {
    const toon = BUILTIN_SHADERS.find((shader) => shader.id === 'builtin-toon')
    expect(toon).toBeDefined()
    if (toon === undefined) return

    const channel0Map = new Texture()
    const channel1Map = new Texture()
    channel1Map.channel = 1
    const channel0 = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map: channel0Map }))
    const channel1Geometry = new BoxGeometry()
    channel1Geometry.setAttribute('uv1', channel1Geometry.getAttribute('uv').clone())
    const channel1 = new Mesh(channel1Geometry, new MeshStandardMaterial({ map: channel1Map }))
    const root = new Group().add(channel0, channel1)
    const camera = new Camera()
    const validationPasses: Array<{
      checking: boolean
      handlerInstalled: boolean
      materials: ShaderMaterial[]
    }> = []
    const renderer: ShaderValidationRenderer = {
      debug: { checkShaderErrors: false, onShaderError: null },
      render: (renderRoot) => {
        validationPasses.push({
          checking: renderer.debug.checkShaderErrors,
          handlerInstalled: renderer.debug.onShaderError !== null,
          materials: shaderMaterialsIn(renderRoot),
        })
      },
    }
    const owner = createGltfSurfaceBindingOwner()
    const override = new MaterialOverride(root, owner.createVariant)
    const prepareRuntime: RuntimeMaterialPreparer = (material) => {
      const prepared = override.prepare(material)
      return {
        validate: (validateRender) => prepared.run(
          () => validateRender(() => renderer.render(root, camera)),
        ),
        commit: () => prepared.commit(),
        dispose: () => prepared.dispose(),
      }
    }
    const compiler = new ShaderCompiler(renderer)

    const result = await compiler.compile(toon, prepareRuntime)

    expect(result).toEqual({ status: 'valid', generation: 1 })
    expect(validationPasses).toHaveLength(2)
    expect(validationPasses.every(({ checking, handlerInstalled }) => checking && handlerInstalled)).toBe(true)
    expect(validationPasses[0].materials).toHaveLength(1)
    expect(validationPasses[0].materials[0].fragmentShader).toContain('vec4 sampleGltfBaseColor()')
    expect(validationPasses[0].materials[0].fragmentShader.endsWith(toon.fragmentSource)).toBe(true)
    expect(validationPasses[0].materials[0].fragmentShader).not.toContain('gltfSrgbToLinear')
    expect(validationPasses[1].materials).toHaveLength(2)
    const channel0Variant = channel0.material as unknown as ShaderMaterial
    const channel1Variant = channel1.material as unknown as ShaderMaterial
    expect(channel0Variant.uniforms.uGltfBaseColorUvChannel.value).toBe(0)
    expect(channel1Variant.uniforms.uGltfBaseColorUvChannel.value).toBe(1)
    expect(channel0Variant.uniforms.uGltfBaseColorMap.value).toBe(channel0Map)
    expect(channel1Variant.uniforms.uGltfBaseColorMap.value).toBe(channel1Map)
    expect(getMaterialInputProfile(channel0Variant)).toBe('gltf-surface')
    expect(getMaterialInputProfile(channel1Variant)).toBe('gltf-surface')
  })

  it('validates editable PBR source and bound PMREM variants through default compiler boundaries', async () => {
    const pmrem = new Texture()
    const environment: EnvironmentBinding = {
      environmentMap: { value: pmrem },
      environmentRotation: { value: new Matrix3() },
      environmentIntensity: { value: 1.25 },
    }
    const channel0Map = new Texture()
    const channel1NormalMap = new Texture()
    channel1NormalMap.channel = 1
    const channel0 = new Mesh(
      new BoxGeometry(),
      new MeshStandardMaterial({ metalnessMap: channel0Map, roughnessMap: channel0Map }),
    )
    const channel1Geometry = new BoxGeometry()
    channel1Geometry.setAttribute('uv1', channel1Geometry.getAttribute('uv').clone())
    const tangentCount = channel1Geometry.getAttribute('position').count
    const tangentValues = new Float32Array(tangentCount * 4)
    for (let index = 0; index < tangentCount; index += 1) {
      tangentValues[index * 4] = 1
      tangentValues[index * 4 + 3] = -1
    }
    channel1Geometry.setAttribute('tangent', new Float32BufferAttribute(tangentValues, 4))
    const channel1 = new Mesh(
      channel1Geometry,
      new MeshStandardMaterial({ normalMap: channel1NormalMap }),
    )
    const root = new Group().add(channel0, channel1)
    const camera = new Camera()
    const validationPasses: ShaderMaterial[][] = []
    const renderer: ShaderValidationRenderer = {
      debug: { checkShaderErrors: false, onShaderError: null },
      render: (renderRoot) => {
        expect(renderer.debug.checkShaderErrors).toBe(true)
        expect(renderer.debug.onShaderError).not.toBeNull()
        validationPasses.push(shaderMaterialsIn(renderRoot))
      },
    }
    const owner = createGltfPbrBindingOwner(environment)
    const override = new MaterialOverride(root, owner.createVariant)
    const prepareRuntime: RuntimeMaterialPreparer = (material) => {
      const prepared = override.prepare(material)
      return {
        validate: (validateRender) => prepared.run(
          () => validateRender(() => renderer.render(root, camera)),
        ),
        commit: () => prepared.commit(),
        dispose: () => prepared.dispose(),
      }
    }
    const compiler = new ShaderCompiler(renderer)
    const parameters: ShaderParameterDefinition[] = [
      { id: 'base-color-tint', type: 'color', uniformName: 'uBaseColorTint', label: 'Base color tint', defaultValue: '#ffffff' },
      { id: 'use-base-color-map', type: 'boolean', uniformName: 'uUseBaseColorMap', label: 'Use base color map', defaultValue: true },
      { id: 'metallic-multiplier', type: 'float', uniformName: 'uMetallicMultiplier', label: 'Metallic multiplier', min: 0, max: 2, step: 0.01, defaultValue: 1 },
      { id: 'roughness-multiplier', type: 'float', uniformName: 'uRoughnessMultiplier', label: 'Roughness multiplier', min: 0, max: 2, step: 0.01, defaultValue: 1 },
      { id: 'use-metallic-roughness-map', type: 'boolean', uniformName: 'uUseMetallicRoughnessMap', label: 'Use metallic roughness map', defaultValue: true },
      { id: 'normal-strength', type: 'float', uniformName: 'uNormalStrength', label: 'Normal strength', min: 0, max: 2, step: 0.01, defaultValue: 1 },
      { id: 'use-normal-map', type: 'boolean', uniformName: 'uUseNormalMap', label: 'Use normal map', defaultValue: true },
      { id: 'environment-contribution', type: 'float', uniformName: 'uEnvironmentContribution', label: 'Environment contribution', min: 0, max: 4, step: 0.01, defaultValue: 1 },
      { id: 'ambient-color', type: 'color', uniformName: 'uAmbientColor', label: 'Ambient color', defaultValue: '#ffffff' },
      { id: 'ambient-intensity', type: 'float', uniformName: 'uAmbientIntensity', label: 'Ambient intensity', min: 0, max: 2, step: 0.01, defaultValue: 0 },
    ]
    const pbrDraft: ShaderDraft = {
      id: 'editable-pbr',
      name: 'PBR',
      origin: 'local',
      fragmentSource: PBR_FRAGMENT_SOURCE,
      parameters,
      parameterValues: Object.fromEntries(parameters.map((parameter) => [parameter.id, parameter.defaultValue])),
      schemaVersion: 2,
      materialInputProfile: 'gltf-pbr',
    }

    const result = await compiler.compile(pbrDraft, prepareRuntime)

    expect(result).toEqual({ status: 'valid', generation: 1 })
    expect(validationPasses).toHaveLength(2)
    expect(validationPasses[0]).toHaveLength(1)
    expect(validationPasses[0][0].fragmentShader).toContain('#include <cube_uv_reflection_fragment>')
    expect(validationPasses[0][0].fragmentShader.endsWith(PBR_FRAGMENT_SOURCE)).toBe(true)
    expect(validationPasses[1]).toHaveLength(2)
    const channel0Variant = channel0.material as unknown as EnvironmentShaderMaterial
    const channel1Variant = channel1.material as unknown as EnvironmentShaderMaterial
    expect(channel0Variant.uniforms.uGltfMetallicMap.value).toBe(channel0Map)
    expect(channel0Variant.uniforms.uGltfRoughnessMap.value).toBe(channel0Map)
    expect(channel1Variant.uniforms.uGltfNormalMap.value).toBe(channel1NormalMap)
    expect(channel1Variant.uniforms.uGltfNormalUvChannel.value).toBe(1)
    expect(channel1Variant.defines?.USE_TANGENT).toBe('')
    expect(channel1Variant.vertexShader).toContain('vGltfWorldTangent')
    expect(channel0Variant.uniforms.uEnvironmentMap).toBe(environment.environmentMap)
    expect(channel1Variant.uniforms.uEnvironmentMap).toBe(environment.environmentMap)
    expect(channel0Variant.envMap).toBe(pmrem)
    expect(channel1Variant.envMap).toBe(pmrem)
    expect(getMaterialInputProfile(channel0Variant)).toBe('gltf-pbr')
    expect(getMaterialInputProfile(channel1Variant)).toBe('gltf-pbr')
  })
})
