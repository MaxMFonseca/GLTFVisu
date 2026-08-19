import { Line, Mesh, Points, type Material, type Object3D, type ShaderMaterial } from 'three'
import type { MaterialVariantFactory } from './materialBindings/types'
import { getMaterialInputProfile, setMaterialInputProfile } from './shaders/materialFactory'

export type { MaterialVariantFactory } from './materialBindings/types'

type MaterialAssignment = Material | Material[]
type MaterialRenderable = Mesh | Line | Points

interface MaterialCompatibility {
  side: Material['side']
  transparent: boolean
  depthTest: boolean
  depthWrite: boolean
  colorWrite: boolean
  blending: Material['blending']
  alphaTest: number
}

export interface PreparedMaterialOverride {
  run<T>(operation: () => T): T
  commit(): void
  dispose(): void
}

/** Owns app-created material assignments while retaining model-owned originals. */
export class MaterialOverride {
  private readonly originals = new Map<MaterialRenderable, MaterialAssignment>()
  private readonly originalMaterials = new Set<Material>()
  private overrideMaterials = new Set<ShaderMaterial>()
  private revision = 0
  private disposed = false

  constructor(
    root: Object3D,
    private readonly createVariant?: MaterialVariantFactory,
  ) {
    root.traverse((object) => {
      if (!isMaterialRenderable(object)) return
      this.originals.set(object, object.material)
      if (Array.isArray(object.material)) {
        for (const material of object.material) this.originalMaterials.add(material)
      } else {
        this.originalMaterials.add(object.material)
      }
    })
  }

  get materials(): readonly ShaderMaterial[] {
    return [...this.overrideMaterials]
  }

  apply(template: ShaderMaterial): void {
    const prepared = this.prepare(template)
    try {
      prepared.commit()
    } catch (error) {
      prepared.dispose()
      throw error
    }
  }

  prepare(template: ShaderMaterial): PreparedMaterialOverride {
    if (this.disposed) throw new Error('Material override is disposed')

    const variants = new Set<ShaderMaterial>()
    const variantsByOriginal = new Map<Material, ShaderMaterial>()
    const compatibilityVariants = new Map<string, ShaderMaterial>()
    const assignments = new Map<MaterialRenderable, MaterialAssignment>()
    const predecessors = new Map<MaterialRenderable, MaterialAssignment>()
    const revision = this.revision

    try {
      for (const [mesh, original] of this.originals) {
        predecessors.set(mesh, mesh.material)
        assignments.set(
          mesh,
          Array.isArray(original)
            ? original.map((material) => this.variantFor(
                material,
                template,
                variants,
                variantsByOriginal,
                compatibilityVariants,
              ))
            : this.variantFor(original, template, variants, variantsByOriginal, compatibilityVariants),
        )
      }
    } catch (error) {
      for (const material of variants) material.dispose()
      throw error
    }

    let completed = false
    const assertCurrent = () => {
      if (completed) throw new Error('Material override transaction is complete')
      if (this.disposed || revision !== this.revision) throw new Error('Material override transaction is stale')
    }

    return {
      run: <T>(operation: () => T): T => {
        assertCurrent()
        for (const [mesh, assignment] of assignments) mesh.material = assignment
        try {
          return operation()
        } finally {
          for (const [mesh, assignment] of predecessors) mesh.material = assignment
        }
      },
      commit: () => {
        assertCurrent()
        const previousMaterials = this.overrideMaterials
        for (const [mesh, assignment] of assignments) mesh.material = assignment
        this.overrideMaterials = variants
        this.revision += 1
        completed = true
        for (const material of previousMaterials) material.dispose()
      },
      dispose: () => {
        if (completed) return
        completed = true
        for (const material of variants) material.dispose()
      },
    }
  }

  restore(): void {
    if (this.disposed) return
    for (const [mesh, original] of this.originals) mesh.material = original
    for (const material of this.overrideMaterials) material.dispose()
    this.overrideMaterials.clear()
    this.revision += 1
  }

  dispose(): void {
    if (this.disposed) return
    this.restore()
    this.originals.clear()
    this.originalMaterials.clear()
    this.disposed = true
  }

  private variantFor(
    original: Material,
    template: ShaderMaterial,
    variants: Set<ShaderMaterial>,
    variantsByOriginal: Map<Material, ShaderMaterial>,
    compatibilityVariants: Map<string, ShaderMaterial>,
  ): ShaderMaterial {
    const existing = variantsByOriginal.get(original)
    if (existing !== undefined) return existing

    const variant = this.createVariant === undefined
      ? defaultVariantFor(original, template, compatibilityVariants)
      : this.createVariant(original, template)
    if (
      variant === template
      || this.originalMaterials.has(variant)
      || this.overrideMaterials.has(variant)
    ) {
      throw new Error('Material variant factory must return a new app-owned ShaderMaterial')
    }

    setMaterialInputProfile(variant, getMaterialInputProfile(template))
    variants.add(variant)
    variantsByOriginal.set(original, variant)
    return variant
  }
}

export function isMaterialRenderable(object: Object3D): object is MaterialRenderable {
  return object instanceof Mesh || object instanceof Line || object instanceof Points
}

function defaultVariantFor(
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
