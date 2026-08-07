import { Mesh, type Material, type Object3D, type ShaderMaterial } from 'three'

type MaterialAssignment = Material | Material[]

interface MaterialCompatibility {
  side: Material['side']
  transparent: boolean
  depthTest: boolean
  depthWrite: boolean
  colorWrite: boolean
  blending: Material['blending']
  alphaTest: number
}

/** Owns app-created material assignments while retaining model-owned originals. */
export class MaterialOverride {
  private readonly originals = new Map<Mesh, MaterialAssignment>()
  private overrideMaterials = new Set<ShaderMaterial>()
  private disposed = false

  constructor(root: Object3D) {
    root.traverse((object) => {
      if (object instanceof Mesh) this.originals.set(object, object.material)
    })
  }

  get materials(): readonly ShaderMaterial[] {
    return [...this.overrideMaterials]
  }

  apply(template: ShaderMaterial): void {
    if (this.disposed) throw new Error('Material override is disposed')

    const variants = new Map<string, ShaderMaterial>()
    const assignments = new Map<Mesh, MaterialAssignment>()

    try {
      for (const [mesh, original] of this.originals) {
        assignments.set(
          mesh,
          Array.isArray(original)
            ? original.map((material) => variantFor(material, template, variants))
            : variantFor(original, template, variants),
        )
      }
    } catch (error) {
      for (const material of variants.values()) material.dispose()
      throw error
    }

    const predecessors = this.overrideMaterials
    for (const [mesh, assignment] of assignments) mesh.material = assignment
    this.overrideMaterials = new Set(variants.values())
    for (const material of predecessors) material.dispose()
  }

  restore(): void {
    if (this.disposed) return
    for (const [mesh, original] of this.originals) mesh.material = original
    for (const material of this.overrideMaterials) material.dispose()
    this.overrideMaterials.clear()
  }

  dispose(): void {
    if (this.disposed) return
    this.restore()
    this.originals.clear()
    this.disposed = true
  }
}

function variantFor(
  original: Material,
  template: ShaderMaterial,
  variants: Map<string, ShaderMaterial>,
): ShaderMaterial {
  const compatibility = compatibilityOf(original)
  const key = JSON.stringify(compatibility)
  const existing = variants.get(key)
  if (existing !== undefined) return existing

  const material = template.clone()
  material.uniforms = template.uniforms
  Object.assign(material, compatibility)
  material.needsUpdate = true
  variants.set(key, material)
  return material
}

function compatibilityOf(material: Material): MaterialCompatibility {
  return {
    side: material.side,
    transparent: material.transparent,
    depthTest: material.depthTest,
    depthWrite: material.depthWrite,
    colorWrite: material.colorWrite,
    blending: material.blending,
    alphaTest: material.alphaTest,
  }
}
