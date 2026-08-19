import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  FrontSide,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  ShaderMaterial,
  Texture,
} from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  getMaterialInputProfile,
  setMaterialInputProfile,
} from './shaders/materialFactory'
import { MaterialOverride, type MaterialVariantFactory } from './MaterialOverride'
import { createMaterialBindingOwner } from './materialBindings/types'

describe('MaterialOverride', () => {
  it('preserves material-array assignments and shares app materials by rendering variant', () => {
    const root = new Group()
    const front = new MeshBasicMaterial({ side: FrontSide })
    const back = new MeshBasicMaterial({ side: BackSide })
    const first = new Mesh(new BoxGeometry(), [front, back, front])
    const second = new Mesh(new BoxGeometry(), front)
    root.add(first, second)
    const template = new ShaderMaterial({ uniforms: { uTime: { value: 0 } } })
    const override = new MaterialOverride(root)

    override.apply(template)

    const firstAssignment = first.material as unknown as ShaderMaterial[]
    expect(firstAssignment).toHaveLength(3)
    expect(firstAssignment[0]).toBe(firstAssignment[2])
    expect(firstAssignment[0]).toBe(second.material)
    expect(firstAssignment[0]).not.toBe(template)
    expect(firstAssignment[0].side).toBe(FrontSide)
    expect(firstAssignment[1].side).toBe(BackSide)
    expect(firstAssignment[0].uniforms).toBe(template.uniforms)
    expect(override.materials).toHaveLength(2)
  })

  it('creates one injected variant per distinct original and preserves shared parameter uniforms', () => {
    const root = new Group()
    const materialA = new MeshBasicMaterial()
    const materialB = new MeshBasicMaterial()
    const meshA = new Mesh(new BoxGeometry(), [materialA, materialA])
    const meshB = new Mesh(new BoxGeometry(), materialB)
    root.add(meshA, meshB)
    const template = new ShaderMaterial({ uniforms: { uGain: { value: 1 } } })
    const factory: MaterialVariantFactory = (original, source) => {
      const variant = source.clone()
      variant.uniforms = {
        ...source.uniforms,
        uOriginalMaterialId: { value: original.uuid },
      }
      return variant
    }
    const override = new MaterialOverride(root, factory)

    override.apply(template)

    const assignmentA = meshA.material as unknown as ShaderMaterial[]
    const assignmentB = meshB.material as unknown as ShaderMaterial
    expect(assignmentA[0]).toBe(assignmentA[1])
    expect(assignmentA[0]).not.toBe(assignmentB)
    expect(assignmentA[0].uniforms.uOriginalMaterialId.value).toBe(materialA.uuid)
    expect(assignmentB.uniforms.uOriginalMaterialId.value).toBe(materialB.uuid)
    expect(assignmentA[0].uniforms.uGain).toBe(template.uniforms.uGain)
    expect(assignmentB.uniforms.uGain).toBe(template.uniforms.uGain)
    expect(override.materials).toHaveLength(2)
  })

  it('propagates the template profile to every injected material without using userData', () => {
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
    const line = new Line(new BufferGeometry(), new LineBasicMaterial())
    const points = new Points(new BufferGeometry(), new PointsMaterial())
    const root = new Group().add(mesh, line, points)
    const template = new ShaderMaterial()
    setMaterialInputProfile(template, 'gltf-pbr')
    const override = new MaterialOverride(root, (_original, source) => source.clone())

    override.apply(template)

    for (const material of override.materials) {
      expect(getMaterialInputProfile(material)).toBe('gltf-pbr')
      expect(material.userData).not.toHaveProperty('materialInputProfile')
    }
    expect(override.materials).toHaveLength(3)
  })

  it('rolls back every prepared variant when injected creation fails', () => {
    const materialA = new MeshBasicMaterial()
    const materialB = new MeshBasicMaterial()
    const meshA = new Mesh(new BoxGeometry(), materialA)
    const meshB = new Mesh(new BoxGeometry(), materialB)
    const root = new Group().add(meshA, meshB)
    const template = new ShaderMaterial()
    let prepared: ShaderMaterial | undefined
    let disposePrepared: ReturnType<typeof vi.spyOn> | undefined
    const override = new MaterialOverride(root, (original, source) => {
      if (original === materialB) throw new Error('binding failed')
      prepared = source.clone()
      disposePrepared = vi.spyOn(prepared, 'dispose')
      return prepared
    })

    expect(() => override.prepare(template)).toThrow('binding failed')

    expect(meshA.material).toBe(materialA)
    expect(meshB.material).toBe(materialB)
    expect(prepared).toBeDefined()
    expect(disposePrepared).toHaveBeenCalledTimes(1)
  })

  it('rejects a factory-owned alias to an original without disposing the original', () => {
    const original = new ShaderMaterial()
    const mesh = new Mesh(new BoxGeometry(), original)
    const disposeOriginal = vi.spyOn(original, 'dispose')
    const override = new MaterialOverride(mesh, (material) => material as ShaderMaterial)

    expect(() => override.apply(new ShaderMaterial())).toThrow('app-owned ShaderMaterial')
    expect(mesh.material).toBe(original)
    expect(disposeOriginal).not.toHaveBeenCalled()
  })

  it('releases binding-owned resources once and rejects use after disposal', () => {
    const releaseResources = vi.fn()
    const owner = createMaterialBindingOwner(
      (_original, template) => template.clone(),
      releaseResources,
    )
    const original = new MeshBasicMaterial()
    const template = new ShaderMaterial()

    expect(owner.createVariant(original, template)).toBeInstanceOf(ShaderMaterial)
    owner.dispose()
    owner.dispose()

    expect(releaseResources).toHaveBeenCalledTimes(1)
    expect(() => owner.createVariant(original, template)).toThrow('Material binding owner is disposed')
  })

  it('restores originals and disposes only materials created by the override', () => {
    const originalTexture = new Texture()
    const original = new MeshBasicMaterial({ map: originalTexture })
    const mesh = new Mesh(new BoxGeometry(), original)
    const override = new MaterialOverride(mesh)
    const template = new ShaderMaterial({ uniforms: { uBorrowedMap: { value: originalTexture } } })
    const disposeOriginal = vi.spyOn(original, 'dispose')
    const disposeOriginalTexture = vi.spyOn(originalTexture, 'dispose')
    const disposeTemplate = vi.spyOn(template, 'dispose')

    override.apply(template)
    const installed = mesh.material as unknown as ShaderMaterial
    const disposeInstalled = vi.spyOn(installed, 'dispose')
    override.dispose()
    override.dispose()

    expect(mesh.material).toBe(original)
    expect(disposeInstalled).toHaveBeenCalledTimes(1)
    expect(disposeOriginal).not.toHaveBeenCalled()
    expect(disposeOriginalTexture).not.toHaveBeenCalled()
    expect(disposeTemplate).not.toHaveBeenCalled()
  })

  it('overrides and restores mesh, line, and point renderables', () => {
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
    const line = new Line(new BufferGeometry(), new LineBasicMaterial())
    const points = new Points(new BufferGeometry(), new PointsMaterial())
    const originals = [mesh.material, line.material, points.material]
    const root = new Group().add(mesh, line, points)
    const override = new MaterialOverride(root)

    override.apply(new ShaderMaterial())

    expect([mesh.material, line.material, points.material]).toEqual([
      expect.any(ShaderMaterial),
      expect.any(ShaderMaterial),
      expect.any(ShaderMaterial),
    ])
    override.dispose()
    expect([mesh.material, line.material, points.material]).toEqual(originals)
  })
})
