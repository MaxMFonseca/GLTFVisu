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

export const GLTF_SURFACE_PROFILE_IDENTIFIERS = [
  ...GLTF_SURFACE_CONTRACT_IDENTIFIERS,
  'sampleGltfBaseColor',
  'vGltfUv1',
  'USE_UV1',
] as const

export const GLTF_PBR_PROFILE_IDENTIFIERS = [
  ...GLTF_SURFACE_PROFILE_IDENTIFIERS,
  ...GLTF_PBR_CONTRACT_IDENTIFIERS.slice(GLTF_SURFACE_CONTRACT_IDENTIFIERS.length),
  'vGltfWorldTangent',
  'USE_TANGENT',
  'ENVMAP_TYPE_CUBE_UV',
  'CUBEUV_TEXEL_WIDTH',
  'CUBEUV_TEXEL_HEIGHT',
  'CUBEUV_MAX_MIP',
] as const

/** Application-owned identifiers injected by the GLTF material input profiles. */
export const PROFILE_CONTRACT_IDENTIFIERS = [
  ...GLTF_PBR_PROFILE_IDENTIFIERS,
] as const
