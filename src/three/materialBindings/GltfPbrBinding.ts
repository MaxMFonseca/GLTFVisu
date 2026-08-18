import type { Material, ShaderMaterial, Texture } from 'three'
import { createGltfSurfaceVariant } from './GltfSurfaceBinding'
import {
  createMaterialBindingOwner,
  type EnvironmentBinding,
  type MaterialBindingOwner,
  type MaterialVariantContext,
  type MaterialVariantFactory,
} from './types'
import {
  createNeutralNormalFallbackTexture,
  createWhiteFallbackTexture,
  extractGltfPbrInputs,
  extractGltfSurfaceInputs,
  type GltfPbrInputs,
  type TextureInput,
} from './textureInputs'

export type EnvironmentShaderMaterial = ShaderMaterial & { envMap: Texture | null }

interface PbrFallbackTextures {
  readonly white: Texture
  readonly normal: Texture
}

const UV0_CONTEXT: Readonly<MaterialVariantContext> = Object.freeze({
  hasUv1: false,
  hasTangent: false,
})

/** Allocates the PBR profile's neutral textures and owns only their lifetime. */
export function createGltfPbrBindingOwner(
  environmentBinding: EnvironmentBinding,
): MaterialBindingOwner {
  const fallbacks = createPbrFallbackTextures()
  const createVariant: MaterialVariantFactory = (original, template, context = UV0_CONTEXT) => (
    createGltfPbrVariantWithFallbacks(original, template, environmentBinding, context, fallbacks)
  )
  createVariant.getCacheKey = (original, context) => {
    const inputs = extractGltfPbrInputs(original)
    const uvKey = needsGeometryUvSplit(original) && context.hasUv1 ? 1 : 0
    const tangentKey = inputs.normal.texture !== null && context.hasTangent ? 2 : 0
    return uvKey | tangentKey
  }

  return createMaterialBindingOwner(createVariant, () => {
    disposePbrFallbackTexturesBestEffort(fallbacks)
  })
}

/**
 * Creates one PBR variant for direct callers. Its private neutral textures follow
 * the returned material's disposal; production callers should use the owner.
 */
export function createGltfPbrVariant(
  original: Material,
  template: ShaderMaterial,
  environmentBinding: EnvironmentBinding,
  context: MaterialVariantContext = UV0_CONTEXT,
): EnvironmentShaderMaterial {
  const fallbacks = createPbrFallbackTextures()
  const variant = createGltfPbrVariantWithFallbacks(
    original,
    template,
    environmentBinding,
    context,
    fallbacks,
  )
  let disposed = false
  variant.addEventListener('dispose', () => {
    if (disposed) return
    disposed = true
    disposePbrFallbackTexturesBestEffort(fallbacks)
  })
  return variant
}

function createGltfPbrVariantWithFallbacks(
  original: Material,
  template: ShaderMaterial,
  environmentBinding: EnvironmentBinding,
  context: MaterialVariantContext,
  fallbacks: PbrFallbackTextures,
): EnvironmentShaderMaterial {
  const inputs = extractGltfPbrInputs(original)
  const metallic = availableTextureInput(inputs.metallic, context)
  const roughness = availableTextureInput(inputs.roughness, context)
  const normal = availableTextureInput(inputs.normal, context)
  const variant = createGltfSurfaceVariant(
    original,
    template,
    fallbacks.white,
    context,
  ) as EnvironmentShaderMaterial

  if ([metallic, roughness, normal].some(hasSecondaryUv)) {
    variant.defines = { ...variant.defines, USE_UV1: '' }
  }
  if (normal.texture !== null && context.hasTangent) {
    variant.defines = { ...variant.defines, USE_TANGENT: '' }
  } else {
    delete variant.defines.USE_TANGENT
  }
  variant.uniforms = {
    ...variant.uniforms,
    uGltfMetallicFactor: { value: inputs.metallicFactor },
    uGltfRoughnessFactor: { value: inputs.roughnessFactor },
    uGltfMetallicMap: { value: metallic.texture ?? fallbacks.white },
    uGltfRoughnessMap: { value: roughness.texture ?? fallbacks.white },
    uGltfHasMetallicMap: { value: metallic.texture !== null },
    uGltfHasRoughnessMap: { value: roughness.texture !== null },
    uGltfMetallicUvChannel: { value: metallic.uvChannel },
    uGltfRoughnessUvChannel: { value: roughness.uvChannel },
    uGltfMetallicUvTransform: { value: metallic.uvTransform },
    uGltfRoughnessUvTransform: { value: roughness.uvTransform },
    uGltfNormalMap: { value: normal.texture ?? fallbacks.normal },
    uGltfHasNormalMap: { value: normal.texture !== null },
    uGltfNormalUvChannel: { value: normal.uvChannel },
    uGltfNormalUvTransform: { value: normal.uvTransform },
    uGltfNormalScale: { value: inputs.normalScale },
    uEnvironmentMap: environmentBinding.environmentMap,
    uEnvironmentRotation: environmentBinding.environmentRotation,
    uEnvironmentIntensity: environmentBinding.environmentIntensity,
  }
  variant.envMap = environmentBinding.environmentMap.value
  variant.needsUpdate = true
  return variant
}

function createPbrFallbackTextures(): PbrFallbackTextures {
  return {
    white: createWhiteFallbackTexture(),
    normal: createNeutralNormalFallbackTexture(),
  }
}

function disposePbrFallbackTexturesBestEffort(fallbacks: PbrFallbackTextures): void {
  for (const texture of [fallbacks.white, fallbacks.normal]) {
    try {
      texture.dispose()
    } catch {
      // Fallback listeners cannot prevent the sibling owned texture from being released.
    }
  }
}

function availableTextureInput(
  input: TextureInput,
  context: MaterialVariantContext,
): TextureInput {
  return input.uvChannel === 1 && !context.hasUv1
    ? { ...input, uvChannel: 0 }
    : input
}

function hasSecondaryUv(input: TextureInput): boolean {
  return input.texture !== null && input.uvChannel === 1
}

function needsGeometryUvSplit(original: Material): boolean {
  const surface = extractGltfSurfaceInputs(original)
  const pbr = extractGltfPbrInputs(original)
  return hasSecondaryUv(surface)
    || pbrTextureInputs(pbr).some(hasSecondaryUv)
}

function pbrTextureInputs(inputs: GltfPbrInputs): readonly TextureInput[] {
  return [inputs.metallic, inputs.roughness, inputs.normal]
}
