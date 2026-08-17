import type { Material, Matrix3, ShaderMaterial, Texture } from 'three'

export interface MaterialVariantContext {
  readonly hasUv1: boolean
}

export type MaterialVariantCacheKey = string | number | boolean | symbol

export interface MaterialVariantFactory {
  (
    original: Material,
    template: ShaderMaterial,
    context?: MaterialVariantContext,
  ): ShaderMaterial
  getCacheKey?: (
    original: Material,
    context: MaterialVariantContext,
  ) => MaterialVariantCacheKey
}

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
  const guardedCreateVariant: MaterialVariantFactory = (original, template, context) => {
    if (disposed) throw new Error('Material binding owner is disposed')
    return createVariant(original, template, context)
  }
  const getCacheKey = createVariant.getCacheKey
  if (getCacheKey !== undefined) {
    guardedCreateVariant.getCacheKey = (original, context) => {
      if (disposed) throw new Error('Material binding owner is disposed')
      return getCacheKey(original, context)
    }
  }

  return {
    createVariant: guardedCreateVariant,
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
