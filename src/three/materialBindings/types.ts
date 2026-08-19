import type { Material, Matrix3, ShaderMaterial, Texture } from 'three'

export type MaterialVariantFactory = (
  original: Material,
  template: ShaderMaterial,
) => ShaderMaterial

/** Engine-owned factory resources, kept separate from model and override ownership. */
export interface MaterialBindingOwner {
  readonly createVariant: MaterialVariantFactory
  dispose(): void
}

export function createMaterialBindingOwner(
  createVariant: MaterialVariantFactory,
  disposeResources: () => void = () => undefined,
): MaterialBindingOwner {
  let disposed = false
  return {
    createVariant: (original, template) => {
      if (disposed) throw new Error('Material binding owner is disposed')
      return createVariant(original, template)
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      disposeResources()
    },
  }
}

/** Shared uniform containers. Resource ownership remains with EnvironmentService. */
export interface EnvironmentBinding {
  environmentMap: { value: Texture | null }
  environmentRotation: { value: Matrix3 }
  environmentIntensity: { value: number }
}
