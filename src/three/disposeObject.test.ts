import { Bone, BoxGeometry, Group, Mesh, MeshBasicMaterial, Skeleton, SkinnedMesh, Texture } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { collectOwnedResources, disposeObjectTree } from './disposeObject'

describe('object resource disposal', () => {
  it('collects shared mesh resources once, including material texture fields and skeletons', () => {
    const root = new Group()
    const geometry = new BoxGeometry()
    const material = new MeshBasicMaterial()
    const texture = new Texture()
    const skeleton = new Skeleton([new Bone()])
    material.map = texture
    const first = new Mesh(geometry, material)
    const second = new SkinnedMesh(geometry, [material])
    second.skeleton = skeleton
    root.add(first, second)

    const resources = collectOwnedResources(root)

    expect(resources.geometries).toEqual(new Set([geometry]))
    expect(resources.materials).toEqual(new Set([material]))
    expect(resources.textures).toEqual(new Set([texture]))
    expect(resources.skeletons).toEqual(new Set([skeleton]))
  })

  it('disposes each owned shared resource once and preserves explicit exclusions', () => {
    const root = new Group()
    const geometry = new BoxGeometry()
    const material = new MeshBasicMaterial()
    const activeOverride = new MeshBasicMaterial()
    const texture = new Texture()
    const skeleton = new Skeleton([new Bone()])
    material.map = texture
    const mesh = new SkinnedMesh(geometry, [material, activeOverride])
    mesh.skeleton = skeleton
    root.add(mesh, new Mesh(geometry, material))

    const disposeGeometry = vi.spyOn(geometry, 'dispose')
    const disposeMaterial = vi.spyOn(material, 'dispose')
    const disposeOverride = vi.spyOn(activeOverride, 'dispose')
    const disposeTexture = vi.spyOn(texture, 'dispose')
    const disposeSkeleton = vi.spyOn(skeleton, 'dispose')

    disposeObjectTree(root, new Set([activeOverride]))

    expect(disposeGeometry).toHaveBeenCalledTimes(1)
    expect(disposeMaterial).toHaveBeenCalledTimes(1)
    expect(disposeOverride).not.toHaveBeenCalled()
    expect(disposeTexture).toHaveBeenCalledTimes(1)
    expect(disposeSkeleton).toHaveBeenCalledTimes(1)
  })

  it('continues through every unique resource when the first material cleanup throws', () => {
    const root = new Group()
    const geometry = new BoxGeometry()
    const firstMaterial = new MeshBasicMaterial()
    const secondMaterial = new MeshBasicMaterial()
    const firstTexture = new Texture()
    const secondTexture = new Texture()
    const skeleton = new Skeleton([new Bone()])
    firstMaterial.map = firstTexture
    secondMaterial.map = secondTexture
    const skinned = new SkinnedMesh(geometry, [firstMaterial, secondMaterial])
    skinned.skeleton = skeleton
    root.add(skinned, new Mesh(geometry, [firstMaterial, secondMaterial]))
    const disposeGeometry = vi.spyOn(geometry, 'dispose')
    const disposeFirstMaterial = vi.spyOn(firstMaterial, 'dispose')
    const disposeSecondMaterial = vi.spyOn(secondMaterial, 'dispose')
    const disposeFirstTexture = vi.spyOn(firstTexture, 'dispose')
    const disposeSecondTexture = vi.spyOn(secondTexture, 'dispose')
    const disposeSkeleton = vi.spyOn(skeleton, 'dispose')
    firstMaterial.addEventListener('dispose', () => {
      throw new Error('first material cleanup failed')
    })

    expect(() => disposeObjectTree(root)).not.toThrow()

    expect(disposeGeometry).toHaveBeenCalledOnce()
    expect(disposeFirstMaterial).toHaveBeenCalledOnce()
    expect(disposeSecondMaterial).toHaveBeenCalledOnce()
    expect(disposeFirstTexture).toHaveBeenCalledOnce()
    expect(disposeSecondTexture).toHaveBeenCalledOnce()
    expect(disposeSkeleton).toHaveBeenCalledOnce()
  })
})
