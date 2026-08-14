export const MATERIAL_INPUT_PROFILES = ['none', 'gltf-surface', 'gltf-pbr'] as const

export type MaterialInputProfile = (typeof MATERIAL_INPUT_PROFILES)[number]

export function parseMaterialInputProfile(value: unknown): MaterialInputProfile {
  if (typeof value !== 'string' || !MATERIAL_INPUT_PROFILES.includes(value as MaterialInputProfile)) {
    throw new Error('Invalid material input profile')
  }
  return value as MaterialInputProfile
}

export const GLTF_SURFACE_CONTRACT_IDENTIFIERS = [
  'uGltfBaseColorFactor',
  'uGltfBaseColorOpacity',
  'uGltfBaseColorMap',
  'uGltfHasBaseColorMap',
  'uGltfBaseColorUvChannel',
  'uGltfBaseColorUvTransform',
  'uGltfAlphaCutoff',
] as const

export const GLTF_PBR_CONTRACT_IDENTIFIERS = [
  ...GLTF_SURFACE_CONTRACT_IDENTIFIERS,
  'uGltfMetallicFactor',
  'uGltfRoughnessFactor',
  'uGltfMetallicMap',
  'uGltfRoughnessMap',
  'uGltfHasMetallicMap',
  'uGltfHasRoughnessMap',
  'uGltfMetallicUvChannel',
  'uGltfRoughnessUvChannel',
  'uGltfMetallicUvTransform',
  'uGltfRoughnessUvTransform',
  'uGltfNormalMap',
  'uGltfHasNormalMap',
  'uGltfNormalUvChannel',
  'uGltfNormalUvTransform',
  'uGltfNormalScale',
  'uEnvironmentMap',
  'uEnvironmentRotation',
  'uEnvironmentIntensity',
] as const

/** Application-owned identifiers injected by the GLTF material input profiles. */
export const PROFILE_CONTRACT_IDENTIFIERS = [
  ...GLTF_PBR_CONTRACT_IDENTIFIERS,
] as const
