import {
  Color,
  DataTexture,
  LineBasicMaterial,
  Material,
  Matrix3,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointsMaterial,
  ShaderMaterial,
  Texture,
} from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createGltfSurfaceBindingOwner } from './GltfSurfaceBinding'

describe('createGltfSurfaceBindingOwner', () => {
  it('creates independent GLTF surface uniforms while sharing application parameter containers', () => {
    const firstMap = new Texture()
    firstMap.channel = 1
    firstMap.offset.set(0.2, 0.3)
    firstMap.repeat.set(0.5, 0.75)
    firstMap.center.set(0.1, 0.4)
    firstMap.rotation = 0.25
    const expectedTransform = new Matrix3().setUvTransform(
      0.2,
      0.3,
      0.5,
      0.75,
      0.25,
      0.1,
      0.4,
    )
    const secondMap = new Texture()
    const first = new MeshStandardMaterial({
      color: '#336699',
      map: firstMap,
      opacity: 0.75,
      transparent: true,
      alphaTest: 0.4,
    })
    const second = new MeshStandardMaterial({ color: '#ff8844', map: secondMap })
    const template = new ShaderMaterial({ uniforms: { uBands: { value: 3 } } })
    const owner = createGltfSurfaceBindingOwner()

    const firstVariant = owner.createVariant(first, template)
    const secondVariant = owner.createVariant(second, template)

    expect(firstVariant).not.toBe(secondVariant)
    expect(firstVariant.uniforms.uGltfBaseColorFactor.value).toEqual(new Color('#336699'))
    expect(firstVariant.uniforms.uGltfBaseColorFactor.value).not.toBe(first.color)
    expect(firstVariant.uniforms.uGltfBaseColorOpacity.value).toBe(0.75)
    expect(firstVariant.uniforms.uGltfBaseColorMap.value).toBe(firstMap)
    expect(firstVariant.uniforms.uGltfHasBaseColorMap.value).toBe(true)
    expect(firstVariant.uniforms.uGltfBaseColorUvChannel.value).toBe(1)
    expect(firstVariant.uniforms.uGltfBaseColorUvTransform.value).toEqual(expectedTransform)
    expect(firstVariant.uniforms.uGltfBaseColorUvTransform.value).not.toBe(firstMap.matrix)
    expect(firstVariant.uniforms.uGltfAlphaCutoff.value).toBe(0.4)
    expect(firstVariant.defines?.USE_UV1).toBe('')
    expect(secondVariant.defines?.USE_UV1).toBeUndefined()
    expect(firstVariant.uniforms.uBands).toBe(template.uniforms.uBands)
    expect(secondVariant.uniforms.uBands).toBe(template.uniforms.uBands)
    expect(firstVariant.uniforms.uGltfBaseColorFactor)
      .not.toBe(secondVariant.uniforms.uGltfBaseColorFactor)
    expect(firstVariant.transparent).toBe(true)
    expect(firstVariant.alphaTest).toBe(0.4)
  })

  it('supports MeshBasicMaterial and capability-compatible custom materials', () => {
    const manualTransform = new Matrix3().set(
      1, 0, 0.25,
      0, 1, 0.5,
      0, 0, 1,
    )
    const basicMap = new Texture()
    basicMap.channel = 7
    basicMap.matrixAutoUpdate = false
    basicMap.matrix.copy(manualTransform)
    const basic = new MeshBasicMaterial({ color: '#224466', map: basicMap, opacity: 0.6 })
    const customMap = new Texture()
    const custom = Object.assign(new Material(), {
      color: new Color('#abcdef'),
      map: customMap,
    })
    const owner = createGltfSurfaceBindingOwner()
    const template = new ShaderMaterial()

    const basicVariant = owner.createVariant(basic, template)
    const customVariant = owner.createVariant(custom, template)

    expect(basicVariant.uniforms.uGltfBaseColorFactor.value).toEqual(new Color('#224466'))
    expect(basicVariant.uniforms.uGltfBaseColorMap.value).toBe(basicMap)
    expect(basicVariant.uniforms.uGltfBaseColorUvChannel.value).toBe(0)
    expect(basicVariant.uniforms.uGltfBaseColorUvTransform.value).toEqual(manualTransform)
    expect(customVariant.uniforms.uGltfBaseColorFactor.value).toEqual(new Color('#abcdef'))
    expect(customVariant.uniforms.uGltfBaseColorMap.value).toBe(customMap)
  })

  it('uses one owned white fallback for generic, line, and point materials', () => {
    const pointMap = new Texture()
    const originals = [
      new Material(),
      new LineBasicMaterial({ color: '#ff0000', opacity: 0.4 }),
      new PointsMaterial({ color: '#00ff00', map: pointMap, opacity: 0.5 }),
    ]
    const owner = createGltfSurfaceBindingOwner()
    const variants = originals.map((original) => owner.createVariant(original, new ShaderMaterial()))
    const fallback = variants[0].uniforms.uGltfBaseColorMap.value as DataTexture
    const disposeFallback = vi.spyOn(fallback, 'dispose')
    const disposePointMap = vi.spyOn(pointMap, 'dispose')

    expect(fallback).toBeInstanceOf(DataTexture)
    expect(fallback.image).toMatchObject({ width: 1, height: 1 })
    expect(Array.from(fallback.image.data as Uint8Array)).toEqual([255, 255, 255, 255])
    for (const variant of variants) {
      expect(variant.uniforms.uGltfBaseColorFactor.value).toEqual(new Color('white'))
      expect(variant.uniforms.uGltfBaseColorMap.value).toBe(fallback)
      expect(variant.uniforms.uGltfHasBaseColorMap.value).toBe(false)
      variant.dispose()
    }
    expect(variants[1].uniforms.uGltfBaseColorOpacity.value).toBe(0.4)
    expect(variants[2].uniforms.uGltfBaseColorOpacity.value).toBe(0.5)
    expect(disposeFallback).not.toHaveBeenCalled()
    expect(disposePointMap).not.toHaveBeenCalled()

    owner.dispose()
    owner.dispose()

    expect(disposeFallback).toHaveBeenCalledTimes(1)
    expect(disposePointMap).not.toHaveBeenCalled()
    expect(() => owner.createVariant(new Material(), new ShaderMaterial()))
      .toThrow('Material binding owner is disposed')
  })

  it('borrows original textures without taking disposal ownership', () => {
    const map = new Texture()
    const disposeMap = vi.spyOn(map, 'dispose')
    const original = new MeshStandardMaterial({ map })
    const owner = createGltfSurfaceBindingOwner()
    const variant = owner.createVariant(original, new ShaderMaterial())

    variant.dispose()
    owner.dispose()

    expect(disposeMap).not.toHaveBeenCalled()
  })
})
