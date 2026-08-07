import {
  BackSide,
  BoxGeometry,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
} from 'three'
import { describe, expect, it, vi } from 'vitest'
import { MaterialOverride } from './MaterialOverride'

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

  it('restores originals and disposes only materials created by the override', () => {
    const original = new MeshBasicMaterial()
    const mesh = new Mesh(new BoxGeometry(), original)
    const override = new MaterialOverride(mesh)
    const template = new ShaderMaterial()
    const disposeOriginal = vi.spyOn(original, 'dispose')
    const disposeTemplate = vi.spyOn(template, 'dispose')

    override.apply(template)
    const installed = mesh.material as unknown as ShaderMaterial
    const disposeInstalled = vi.spyOn(installed, 'dispose')
    override.dispose()
    override.dispose()

    expect(mesh.material).toBe(original)
    expect(disposeInstalled).toHaveBeenCalledTimes(1)
    expect(disposeOriginal).not.toHaveBeenCalled()
    expect(disposeTemplate).not.toHaveBeenCalled()
  })
})
