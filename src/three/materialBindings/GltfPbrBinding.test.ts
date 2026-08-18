import {
  BoxGeometry,
  Color,
  CubeUVReflectionMapping,
  DataTexture,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  Material,
  Matrix3,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  ShaderMaterial,
  Texture,
  Vector2,
} from 'three'
import { describe, expect, it, vi } from 'vitest'
import { MaterialOverride } from '../MaterialOverride'
import type { EnvironmentBinding } from './types'
import {
  createGltfPbrBindingOwner,
  createGltfPbrVariant,
  type EnvironmentShaderMaterial,
} from './GltfPbrBinding'

function environmentBinding(texture: Texture | null = new Texture()): EnvironmentBinding {
  if (texture !== null) texture.mapping = CubeUVReflectionMapping
  return {
    environmentMap: { value: texture },
    environmentRotation: { value: new Matrix3().set(
      0, 0, 1,
      0, 1, 0,
      -1, 0, 0,
    ) },
    environmentIntensity: { value: 1.75 },
  }
}

describe('createGltfPbrVariant', () => {
  it('binds physical material factors, packed maps, normal inputs, and shared environment containers', () => {
    const baseColorMap = new Texture()
    const packedMetallicRoughnessMap = new Texture()
    packedMetallicRoughnessMap.channel = 1
    const normalMap = new Texture()
    normalMap.channel = 1
    const normalScale = new Vector2(0.6, -0.4)
    const original = new MeshPhysicalMaterial({
      color: '#8ab4f8',
      map: baseColorMap,
      metalness: 0.65,
      roughness: 0.3,
      metalnessMap: packedMetallicRoughnessMap,
      roughnessMap: packedMetallicRoughnessMap,
      normalMap,
      normalScale,
    })
    const template = new ShaderMaterial({
      uniforms: {
        uBaseColorTint: { value: new Color('white') },
        uMetallicMultiplier: { value: 1 },
      },
    })
    const environment = environmentBinding()

    const variant = createGltfPbrVariant(
      original,
      template,
      environment,
      { hasUv1: true, hasTangent: false },
    )

    expect(variant.uniforms.uGltfMetallicFactor.value).toBe(0.65)
    expect(variant.uniforms.uGltfRoughnessFactor.value).toBe(0.3)
    expect(variant.uniforms.uGltfMetallicMap.value).toBe(packedMetallicRoughnessMap)
    expect(variant.uniforms.uGltfRoughnessMap.value).toBe(packedMetallicRoughnessMap)
    expect(variant.uniforms.uGltfHasMetallicMap.value).toBe(true)
    expect(variant.uniforms.uGltfHasRoughnessMap.value).toBe(true)
    expect(variant.uniforms.uGltfMetallicUvChannel.value).toBe(1)
    expect(variant.uniforms.uGltfRoughnessUvChannel.value).toBe(1)
    expect(variant.uniforms.uGltfNormalMap.value).toBe(normalMap)
    expect(variant.uniforms.uGltfHasNormalMap.value).toBe(true)
    expect(variant.uniforms.uGltfNormalUvChannel.value).toBe(1)
    expect(variant.uniforms.uGltfNormalScale.value).toEqual(normalScale)
    expect(variant.uniforms.uGltfNormalScale.value).not.toBe(normalScale)
    expect(variant.uniforms.uEnvironmentMap).toBe(environment.environmentMap)
    expect(variant.uniforms.uEnvironmentRotation).toBe(environment.environmentRotation)
    expect(variant.uniforms.uEnvironmentIntensity).toBe(environment.environmentIntensity)
    expect((variant as EnvironmentShaderMaterial).envMap).toBe(environment.environmentMap.value)
    expect(variant.uniforms.uBaseColorTint).toBe(template.uniforms.uBaseColorTint)
    expect(variant.uniforms.uMetallicMultiplier).toBe(template.uniforms.uMetallicMultiplier)
    expect(variant.defines?.USE_UV1).toBe('')
  })

  it('keeps distinct data maps, UV channels, transforms, and color-space metadata independent', () => {
    const metalnessMap = new Texture()
    metalnessMap.channel = 1
    metalnessMap.offset.set(0.2, 0.3)
    metalnessMap.repeat.set(0.4, 0.5)
    metalnessMap.rotation = 0.25
    const roughnessMap = new Texture()
    roughnessMap.offset.set(0.6, 0.7)
    roughnessMap.repeat.set(0.8, 0.9)
    const normalMap = new Texture()
    normalMap.channel = 1
    normalMap.matrixAutoUpdate = false
    normalMap.matrix.set(
      1, 0, 0.125,
      0, 1, 0.375,
      0, 0, 1,
    )
    const original = new MeshStandardMaterial({ metalnessMap, roughnessMap, normalMap })

    const variant = createGltfPbrVariant(
      original,
      new ShaderMaterial(),
      environmentBinding(),
      { hasUv1: true, hasTangent: false },
    )

    expect(variant.uniforms.uGltfMetallicMap.value).toBe(metalnessMap)
    expect(variant.uniforms.uGltfRoughnessMap.value).toBe(roughnessMap)
    expect(variant.uniforms.uGltfNormalMap.value).toBe(normalMap)
    expect(variant.uniforms.uGltfMetallicUvChannel.value).toBe(1)
    expect(variant.uniforms.uGltfRoughnessUvChannel.value).toBe(0)
    expect(variant.uniforms.uGltfNormalUvChannel.value).toBe(1)
    expect(variant.uniforms.uGltfMetallicUvTransform.value).toEqual(
      new Matrix3().setUvTransform(0.2, 0.3, 0.4, 0.5, 0.25, 0, 0),
    )
    expect(variant.uniforms.uGltfRoughnessUvTransform.value).toEqual(
      new Matrix3().setUvTransform(0.6, 0.7, 0.8, 0.9, 0, 0, 0),
    )
    expect(variant.uniforms.uGltfNormalUvTransform.value).toEqual(normalMap.matrix)
    expect(variant.uniforms.uGltfNormalUvTransform.value).not.toBe(normalMap.matrix)
    expect(metalnessMap.colorSpace).toBe(NoColorSpace)
    expect(roughnessMap.colorSpace).toBe(NoColorSpace)
    expect(normalMap.colorSpace).toBe(NoColorSpace)
  })

  it('uses finite neutral factors and normal scale for absent or incompatible capabilities', () => {
    const invalidNormalMap = new Texture()
    const invalid = new MeshStandardMaterial({ normalMap: invalidNormalMap })
    invalid.metalness = Number.NaN
    invalid.roughness = Number.POSITIVE_INFINITY
    invalid.normalScale.set(Number.NaN, Number.NEGATIVE_INFINITY)
    const line = Object.assign(new LineBasicMaterial(), {
      metalness: 0.9,
      roughness: 0.1,
      metalnessMap: new Texture(),
      roughnessMap: new Texture(),
      normalMap: new Texture(),
      normalScale: new Vector2(0.2, 0.3),
    })

    const invalidVariant = createGltfPbrVariant(invalid, new ShaderMaterial(), environmentBinding(null))
    const incompatibleVariant = createGltfPbrVariant(line, new ShaderMaterial(), environmentBinding(null))

    expect(invalidVariant.uniforms.uGltfMetallicFactor.value).toBe(0)
    expect(invalidVariant.uniforms.uGltfRoughnessFactor.value).toBe(1)
    expect(invalidVariant.uniforms.uGltfNormalScale.value).toEqual(new Vector2(1, 1))
    expect(invalidVariant.uniforms.uGltfNormalMap.value).toBe(invalidNormalMap)
    expect(invalidVariant.uniforms.uGltfHasNormalMap.value).toBe(true)
    expect((invalidVariant as EnvironmentShaderMaterial).envMap).toBeNull()
    expect(incompatibleVariant.uniforms.uGltfMetallicFactor.value).toBe(0)
    expect(incompatibleVariant.uniforms.uGltfRoughnessFactor.value).toBe(1)
    expect(incompatibleVariant.uniforms.uGltfHasMetallicMap.value).toBe(false)
    expect(incompatibleVariant.uniforms.uGltfHasRoughnessMap.value).toBe(false)
    expect(incompatibleVariant.uniforms.uGltfHasNormalMap.value).toBe(false)

    const whiteFallback = incompatibleVariant.uniforms.uGltfMetallicMap.value as DataTexture
    const normalFallback = incompatibleVariant.uniforms.uGltfNormalMap.value as DataTexture
    expect(Array.from(whiteFallback.image.data as Uint8Array)).toEqual([255, 255, 255, 255])
    expect(Array.from(normalFallback.image.data as Uint8Array)).toEqual([128, 128, 255, 255])
  })

  it('preserves GLTFLoader tangent and derivative normal-scale Y conventions', () => {
    const normalMap = new Texture()
    const tangentMaterial = new MeshStandardMaterial({
      normalMap,
      normalScale: new Vector2(0.5, 0.75),
    })
    const derivativeMaterial = new MeshStandardMaterial({
      normalMap,
      normalScale: new Vector2(0.5, -0.75),
    })
    const owner = createGltfPbrBindingOwner(environmentBinding())

    const tangentVariant = owner.createVariant(
      tangentMaterial,
      new ShaderMaterial(),
      { hasUv1: false, hasTangent: true },
    )
    const derivativeVariant = owner.createVariant(
      derivativeMaterial,
      new ShaderMaterial(),
      { hasUv1: false, hasTangent: false },
    )

    expect(tangentVariant.defines?.USE_TANGENT).toBe('')
    expect(derivativeVariant.defines?.USE_TANGENT).toBeUndefined()
    expect(tangentVariant.uniforms.uGltfNormalScale.value).toEqual(new Vector2(0.5, 0.75))
    expect(derivativeVariant.uniforms.uGltfNormalScale.value).toEqual(new Vector2(0.5, -0.75))
  })

  it('disposes both private fallbacks once when listeners reenter and throw', () => {
    const variant = createGltfPbrVariant(
      new Material(),
      new ShaderMaterial(),
      environmentBinding(null),
    )
    const white = variant.uniforms.uGltfMetallicMap.value as DataTexture
    const normal = variant.uniforms.uGltfNormalMap.value as DataTexture
    const disposeWhite = vi.spyOn(white, 'dispose')
    const disposeNormal = vi.spyOn(normal, 'dispose')
    white.addEventListener('dispose', () => {
      variant.dispose()
      throw new Error('white fallback listener failed')
    })
    normal.addEventListener('dispose', () => {
      variant.dispose()
      throw new Error('normal fallback listener failed')
    })

    expect(() => variant.dispose()).not.toThrow()
    expect(() => variant.dispose()).not.toThrow()

    expect(disposeWhite).toHaveBeenCalledTimes(1)
    expect(disposeNormal).toHaveBeenCalledTimes(1)
  })
})

describe('createGltfPbrBindingOwner', () => {
  it.each([
    ['base color', 'map'],
    ['metallic', 'metalnessMap'],
    ['roughness', 'roughnessMap'],
    ['normal', 'normalMap'],
  ] as const)('splits shared-material variants by UV1 availability for the %s map', (_label, property) => {
    const channelOneMap = new Texture()
    channelOneMap.channel = 1
    const original = new MeshStandardMaterial()
    original[property] = channelOneMap
    const withoutUv1A = new Mesh(new BoxGeometry(), original)
    const withoutUv1B = new Mesh(new BoxGeometry(), original)
    const withUv1Geometry = new BoxGeometry()
    withUv1Geometry.setAttribute('uv1', withUv1Geometry.getAttribute('uv').clone())
    const withUv1 = new Mesh(withUv1Geometry, original)
    const owner = createGltfPbrBindingOwner(environmentBinding())
    const override = new MaterialOverride(
      new Group().add(withoutUv1A, withoutUv1B, withUv1),
      owner.createVariant,
    )

    override.apply(new ShaderMaterial())

    const withoutUv1Variant = withoutUv1A.material as unknown as ShaderMaterial
    const repeatedVariant = withoutUv1B.material as unknown as ShaderMaterial
    const withUv1Variant = withUv1.material as unknown as ShaderMaterial
    const uniformPrefix = property === 'map'
      ? 'BaseColor'
      : property === 'metalnessMap'
        ? 'Metallic'
        : property === 'roughnessMap'
          ? 'Roughness'
          : 'Normal'
    expect(withoutUv1Variant).toBe(repeatedVariant)
    expect(withoutUv1Variant).not.toBe(withUv1Variant)
    expect(withoutUv1Variant.uniforms[`uGltf${uniformPrefix}UvChannel`].value).toBe(0)
    expect(withUv1Variant.uniforms[`uGltf${uniformPrefix}UvChannel`].value).toBe(1)
    expect(withoutUv1Variant.defines?.USE_UV1).toBeUndefined()
    expect(withUv1Variant.defines?.USE_UV1).toBe('')
    expect(override.materials).toHaveLength(2)
  })

  it('owns only shared neutral fallbacks and borrows every GLTF and environment texture', () => {
    const metalnessMap = new Texture()
    const roughnessMap = new Texture()
    const normalMap = new Texture()
    const pmrem = new Texture()
    const disposeBorrowed = [metalnessMap, roughnessMap, normalMap, pmrem]
      .map((texture) => vi.spyOn(texture, 'dispose'))
    const owner = createGltfPbrBindingOwner(environmentBinding(pmrem))
    const populated = owner.createVariant(
      new MeshStandardMaterial({ metalnessMap, roughnessMap, normalMap }),
      new ShaderMaterial(),
    )
    const neutral = owner.createVariant(new Material(), new ShaderMaterial())
    const disposeWhite = vi.spyOn(neutral.uniforms.uGltfMetallicMap.value as DataTexture, 'dispose')
    const disposeNormal = vi.spyOn(neutral.uniforms.uGltfNormalMap.value as DataTexture, 'dispose')

    populated.dispose()
    neutral.dispose()
    owner.dispose()
    owner.dispose()

    expect(disposeWhite).toHaveBeenCalledTimes(1)
    expect(disposeNormal).toHaveBeenCalledTimes(1)
    for (const dispose of disposeBorrowed) expect(dispose).not.toHaveBeenCalled()
  })

  it('disposes both owner fallbacks once when listeners reenter and throw', () => {
    const owner = createGltfPbrBindingOwner(environmentBinding(null))
    const variant = owner.createVariant(new Material(), new ShaderMaterial())
    const white = variant.uniforms.uGltfMetallicMap.value as DataTexture
    const normal = variant.uniforms.uGltfNormalMap.value as DataTexture
    const disposeWhite = vi.spyOn(white, 'dispose')
    const disposeNormal = vi.spyOn(normal, 'dispose')
    white.addEventListener('dispose', () => {
      owner.dispose()
      throw new Error('white owner fallback listener failed')
    })
    normal.addEventListener('dispose', () => {
      owner.dispose()
      throw new Error('normal owner fallback listener failed')
    })

    expect(() => owner.dispose()).not.toThrow()
    expect(() => owner.dispose()).not.toThrow()

    expect(disposeWhite).toHaveBeenCalledTimes(1)
    expect(disposeNormal).toHaveBeenCalledTimes(1)
  })

  it('splits a shared normal-mapped material by tangent availability', () => {
    const original = new MeshStandardMaterial({ normalMap: new Texture() })
    const withoutTangentsA = new Mesh(new BoxGeometry(), original)
    const withoutTangentsB = new Mesh(new BoxGeometry(), original)
    const tangentGeometry = new BoxGeometry()
    const tangentCount = tangentGeometry.getAttribute('position').count
    const tangents = new Float32Array(tangentCount * 4)
    for (let index = 0; index < tangentCount; index += 1) {
      tangents[index * 4] = 1
      tangents[index * 4 + 3] = -1
    }
    tangentGeometry.setAttribute('tangent', new Float32BufferAttribute(tangents, 4))
    const withTangents = new Mesh(tangentGeometry, original)
    const owner = createGltfPbrBindingOwner(environmentBinding())
    const override = new MaterialOverride(
      new Group().add(withoutTangentsA, withoutTangentsB, withTangents),
      owner.createVariant,
    )

    override.apply(new ShaderMaterial())

    const derivativeVariant = withoutTangentsA.material as unknown as ShaderMaterial
    const repeatedDerivativeVariant = withoutTangentsB.material as unknown as ShaderMaterial
    const tangentVariant = withTangents.material as unknown as ShaderMaterial
    expect(derivativeVariant).toBe(repeatedDerivativeVariant)
    expect(tangentVariant).not.toBe(derivativeVariant)
    expect(derivativeVariant.defines?.USE_TANGENT).toBeUndefined()
    expect(tangentVariant.defines?.USE_TANGENT).toBe('')
    expect(override.materials).toHaveLength(2)
  })
})
