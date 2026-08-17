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

  it('rolls back partial assignments when prepared run cannot install every variant', () => {
    const originalA = new MeshBasicMaterial()
    const originalB = new MeshBasicMaterial()
    const meshA = new Mesh(new BoxGeometry(), originalA)
    const meshB = new Mesh(new BoxGeometry(), originalB)
    const root = new Group().add(meshA, meshB)
    const template = new ShaderMaterial()
    const disposeOriginalA = vi.spyOn(originalA, 'dispose')
    const disposeOriginalB = vi.spyOn(originalB, 'dispose')
    const disposeTemplate = vi.spyOn(template, 'dispose')
    const disposeVariants: ReturnType<typeof vi.spyOn>[] = []
    const override = new MaterialOverride(root, (_original, source) => {
      const variant = source.clone()
      disposeVariants.push(vi.spyOn(variant, 'dispose'))
      return variant
    })
    const prepared = override.prepare(template)
    rejectMaterialChanges(meshB)
    const operation = vi.fn()

    expect(() => prepared.run(operation)).toThrow('assignment rejected')

    expect(operation).not.toHaveBeenCalled()
    expect(meshA.material).toBe(originalA)
    expect(meshB.material).toBe(originalB)
    prepared.dispose()
    prepared.dispose()
    expect(disposeVariants).toHaveLength(2)
    for (const disposeVariant of disposeVariants) expect(disposeVariant).toHaveBeenCalledTimes(1)
    expect(disposeOriginalA).not.toHaveBeenCalled()
    expect(disposeOriginalB).not.toHaveBeenCalled()
    expect(disposeTemplate).not.toHaveBeenCalled()
  })

  it('keeps the active transaction current when apply cannot install every variant', () => {
    const originalA = new MeshBasicMaterial()
    const originalB = new MeshBasicMaterial()
    const meshA = new Mesh(new BoxGeometry(), originalA)
    const meshB = new Mesh(new BoxGeometry(), originalB)
    const root = new Group().add(meshA, meshB)
    const activeTemplate = new ShaderMaterial()
    const outstandingTemplate = new ShaderMaterial()
    const failingTemplate = new ShaderMaterial()
    const templateDisposers = [activeTemplate, outstandingTemplate, failingTemplate]
      .map((template) => vi.spyOn(template, 'dispose'))
    const disposers = new Map<ShaderMaterial, ReturnType<typeof vi.spyOn>[]>()
    const override = new MaterialOverride(root, (_original, source) => {
      const variant = source.clone()
      const dispose = vi.spyOn(variant, 'dispose')
      const sourceDisposers = disposers.get(source) ?? []
      sourceDisposers.push(dispose)
      disposers.set(source, sourceDisposers)
      return variant
    })
    override.apply(activeTemplate)
    const activeAssignments = [meshA.material, meshB.material]
    const outstanding = override.prepare(outstandingTemplate)
    const allowMaterialChanges = rejectMaterialChanges(meshB)

    expect(() => override.apply(failingTemplate)).toThrow('assignment rejected')

    expect([meshA.material, meshB.material]).toEqual(activeAssignments)
    expect(override.materials).toEqual(activeAssignments)
    expect(disposers.get(failingTemplate)).toHaveLength(2)
    expect(disposers.get(activeTemplate)).toHaveLength(2)
    expect(disposers.get(outstandingTemplate)).toHaveLength(2)
    for (const dispose of disposers.get(failingTemplate) ?? []) expect(dispose).toHaveBeenCalledTimes(1)
    for (const dispose of disposers.get(activeTemplate) ?? []) expect(dispose).not.toHaveBeenCalled()
    for (const dispose of disposers.get(outstandingTemplate) ?? []) expect(dispose).not.toHaveBeenCalled()

    allowMaterialChanges()
    expect(() => outstanding.commit()).not.toThrow()
    expect([meshA.material, meshB.material]).not.toEqual(activeAssignments)
    for (const dispose of disposers.get(activeTemplate) ?? []) expect(dispose).toHaveBeenCalledTimes(1)
    outstanding.dispose()
    override.dispose()
    for (const dispose of disposers.get(outstandingTemplate) ?? []) expect(dispose).toHaveBeenCalledTimes(1)
    for (const disposeTemplate of templateDisposers) expect(disposeTemplate).not.toHaveBeenCalled()
  })

  it('rejects one injected variant returned for two distinct originals and disposes it once', () => {
    const originalA = new MeshBasicMaterial()
    const originalB = new MeshBasicMaterial()
    const meshA = new Mesh(new BoxGeometry(), originalA)
    const meshB = new Mesh(new BoxGeometry(), originalB)
    const template = new ShaderMaterial()
    const shared = new ShaderMaterial()
    const disposeOriginalA = vi.spyOn(originalA, 'dispose')
    const disposeOriginalB = vi.spyOn(originalB, 'dispose')
    const disposeTemplate = vi.spyOn(template, 'dispose')
    const disposeShared = vi.spyOn(shared, 'dispose')
    const override = new MaterialOverride(new Group().add(meshA, meshB), () => shared)

    expect(() => override.prepare(template)).toThrow('fresh app-owned ShaderMaterial')

    expect(meshA.material).toBe(originalA)
    expect(meshB.material).toBe(originalB)
    expect(disposeShared).toHaveBeenCalledTimes(1)
    expect(disposeOriginalA).not.toHaveBeenCalled()
    expect(disposeOriginalB).not.toHaveBeenCalled()
    expect(disposeTemplate).not.toHaveBeenCalled()
  })

  it('reserves injected variants across outstanding prepares without disposing another owner alias', () => {
    const original = new MeshBasicMaterial()
    const mesh = new Mesh(new BoxGeometry(), original)
    const firstTemplate = new ShaderMaterial()
    const secondTemplate = new ShaderMaterial()
    const shared = new ShaderMaterial()
    const disposeOriginal = vi.spyOn(original, 'dispose')
    const disposeFirstTemplate = vi.spyOn(firstTemplate, 'dispose')
    const disposeSecondTemplate = vi.spyOn(secondTemplate, 'dispose')
    const disposeShared = vi.spyOn(shared, 'dispose')
    const override = new MaterialOverride(mesh, () => shared)
    const first = override.prepare(firstTemplate)

    expect(() => override.prepare(secondTemplate)).toThrow('fresh app-owned ShaderMaterial')

    expect(mesh.material).toBe(original)
    expect(disposeShared).not.toHaveBeenCalled()
    expect(disposeOriginal).not.toHaveBeenCalled()
    expect(disposeFirstTemplate).not.toHaveBeenCalled()
    expect(disposeSecondTemplate).not.toHaveBeenCalled()
    first.dispose()
    first.dispose()
    expect(disposeShared).toHaveBeenCalledTimes(1)
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

function rejectMaterialChanges(mesh: Mesh): () => void {
  let material = mesh.material
  let rejecting = true
  Object.defineProperty(mesh, 'material', {
    configurable: true,
    get: () => material,
    set: (next: Mesh['material']) => {
      if (rejecting && next !== material) throw new Error('assignment rejected')
      material = next
    },
  })
  return () => { rejecting = false }
}
