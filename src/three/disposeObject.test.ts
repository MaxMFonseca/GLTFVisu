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
})
