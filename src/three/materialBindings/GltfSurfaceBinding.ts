import type { Material, ShaderMaterial, Texture } from 'three'
import { createMaterialBindingOwner, type MaterialBindingOwner } from './types'
import { createWhiteFallbackTexture, extractGltfSurfaceInputs } from './textureInputs'

/** Allocates the surface profile's one shared fallback texture and owns its lifetime. */
export function createGltfSurfaceBindingOwner(): MaterialBindingOwner {
  const whiteFallback = createWhiteFallbackTexture()
  return createMaterialBindingOwner(
    (original, template) => createGltfSurfaceVariant(original, template, whiteFallback),
    () => whiteFallback.dispose(),
  )
}

/** Creates one app-owned shader variant while borrowing GLTF texture resources. */
export function createGltfSurfaceVariant(
  original: Material,
  template: ShaderMaterial,
  whiteFallback: Texture,
): ShaderMaterial {
  const inputs = extractGltfSurfaceInputs(original)
  const variant = template.clone()
  variant.defines = { ...template.defines }
  if (inputs.texture !== null && inputs.uvChannel === 1) {
    variant.defines.USE_UV1 = ''
  } else {
    delete variant.defines.USE_UV1
  }
  variant.uniforms = {
    ...template.uniforms,
    uGltfBaseColorFactor: { value: inputs.baseColorFactor },
    uGltfBaseColorOpacity: { value: inputs.opacity },
    uGltfBaseColorMap: { value: inputs.texture ?? whiteFallback },
    uGltfHasBaseColorMap: { value: inputs.texture !== null },
    uGltfBaseColorUvChannel: { value: inputs.uvChannel },
    uGltfBaseColorUvTransform: { value: inputs.uvTransform },
    uGltfAlphaCutoff: { value: inputs.alphaCutoff },
  }
  copyMaterialCompatibility(original, variant)
  return variant
}

function copyMaterialCompatibility(original: Material, variant: ShaderMaterial): void {
  variant.side = original.side
  variant.transparent = original.transparent
  variant.depthTest = original.depthTest
  variant.depthWrite = original.depthWrite
  variant.colorWrite = original.colorWrite
  variant.blending = original.blending
  variant.alphaTest = original.alphaTest
  variant.needsUpdate = true
}
