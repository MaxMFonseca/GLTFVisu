import { Line, Mesh, Points, type Material, type Object3D, type ShaderMaterial } from 'three'
import type {
  MaterialVariantCacheKey,
  MaterialVariantContext,
  MaterialVariantFactory,
} from './materialBindings/types'
import { getMaterialInputProfile, setMaterialInputProfile } from './shaders/materialFactory'

export type { MaterialVariantFactory } from './materialBindings/types'

type MaterialAssignment = Material | Material[]
type MaterialRenderable = Mesh | Line | Points

const DEFAULT_VARIANT_CACHE_KEY = Symbol('default material variant')
const UV0_VARIANT_CONTEXT: Readonly<MaterialVariantContext> = Object.freeze({ hasUv1: false })
const UV1_VARIANT_CONTEXT: Readonly<MaterialVariantContext> = Object.freeze({ hasUv1: true })

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
  private readonly reservedVariants = new Set<ShaderMaterial>()
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
    const variantsByOriginal = new Map<Material, Map<MaterialVariantCacheKey, ShaderMaterial>>()
    const compatibilityVariants = new Map<string, ShaderMaterial>()
    const assignments = new Map<MaterialRenderable, MaterialAssignment>()
    const predecessors = new Map<MaterialRenderable, MaterialAssignment>()
    const revision = this.revision

    try {
      for (const [mesh, original] of this.originals) {
        predecessors.set(mesh, mesh.material)
        const context = variantContextFor(mesh)
        assignments.set(
          mesh,
          Array.isArray(original)
            ? original.map((material) => this.variantFor(
                material,
                template,
                variants,
                variantsByOriginal,
                compatibilityVariants,
                context,
              ))
            : this.variantFor(
                original,
                template,
                variants,
                variantsByOriginal,
                compatibilityVariants,
                context,
              ),
        )
      }
    } catch (error) {
      this.releaseReservations(variants)
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
        const changed = assignMaterials(assignments, predecessors)
        try {
          return operation()
        } finally {
          restoreMaterials(changed, predecessors)
        }
      },
      commit: () => {
        assertCurrent()
        const previousMaterials = this.overrideMaterials
        assignMaterials(assignments, predecessors)
        this.overrideMaterials = variants
        this.revision += 1
        completed = true
        this.releaseReservations(variants)
        for (const material of previousMaterials) material.dispose()
      },
      dispose: () => {
        if (completed) return
        completed = true
        this.releaseReservations(variants)
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
    variantsByOriginal: Map<Material, Map<MaterialVariantCacheKey, ShaderMaterial>>,
    compatibilityVariants: Map<string, ShaderMaterial>,
    context: MaterialVariantContext,
  ): ShaderMaterial {
    const cacheKey = this.createVariant?.getCacheKey?.(original, context) ?? DEFAULT_VARIANT_CACHE_KEY
    const cachedVariants = variantsByOriginal.get(original)
    const existing = cachedVariants?.get(cacheKey)
    if (existing !== undefined) return existing

    const variant = this.createVariant === undefined
      ? defaultVariantFor(original, template, compatibilityVariants)
      : this.createVariant(original, template, context)
    if (
      variant === template
      || this.originalMaterials.has(variant)
      || this.overrideMaterials.has(variant)
      || (this.createVariant !== undefined && (
        variants.has(variant)
        || this.reservedVariants.has(variant)
      ))
    ) {
      throw new Error('Material variant factory must return a fresh app-owned ShaderMaterial')
    }

    setMaterialInputProfile(variant, getMaterialInputProfile(template))
    variants.add(variant)
    if (this.createVariant !== undefined) this.reservedVariants.add(variant)
    if (cachedVariants === undefined) {
      variantsByOriginal.set(original, new Map([[cacheKey, variant]]))
    } else {
      cachedVariants.set(cacheKey, variant)
    }
    return variant
  }

  private releaseReservations(variants: ReadonlySet<ShaderMaterial>): void {
    for (const variant of variants) this.reservedVariants.delete(variant)
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

function variantContextFor(renderable: MaterialRenderable): Readonly<MaterialVariantContext> {
  return renderable.geometry.getAttribute('uv1') === undefined
    ? UV0_VARIANT_CONTEXT
    : UV1_VARIANT_CONTEXT
}

function assignMaterials(
  assignments: ReadonlyMap<MaterialRenderable, MaterialAssignment>,
  predecessors: ReadonlyMap<MaterialRenderable, MaterialAssignment>,
): MaterialRenderable[] {
  const changed: MaterialRenderable[] = []
  try {
    for (const [renderable, assignment] of assignments) {
      renderable.material = assignment
      changed.push(renderable)
    }
    return changed
  } catch (error) {
    restoreMaterials(changed, predecessors)
    throw error
  }
}

function restoreMaterials(
  changed: readonly MaterialRenderable[],
  predecessors: ReadonlyMap<MaterialRenderable, MaterialAssignment>,
): void {
  for (let index = changed.length - 1; index >= 0; index -= 1) {
    const renderable = changed[index]
    const predecessor = predecessors.get(renderable)
    if (predecessor !== undefined) renderable.material = predecessor
  }
}
