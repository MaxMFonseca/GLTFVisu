import {
  GLTF_PBR_CONTRACT_IDENTIFIERS,
  GLTF_SURFACE_CONTRACT_IDENTIFIERS,
  type MaterialInputProfile,
} from '../../domain/materialInput'

type GltfSurfaceContractIdentifier = (typeof GLTF_SURFACE_CONTRACT_IDENTIFIERS)[number]
type GltfPbrContractIdentifier = (typeof GLTF_PBR_CONTRACT_IDENTIFIERS)[number]
type GltfPbrOnlyContractIdentifier = Exclude<
  GltfPbrContractIdentifier,
  GltfSurfaceContractIdentifier
>

const GLTF_SURFACE_UNIFORM_TYPES = {
  uGltfBaseColorFactor: 'vec3',
  uGltfBaseColorOpacity: 'float',
  uGltfBaseColorMap: 'sampler2D',
  uGltfHasBaseColorMap: 'bool',
  uGltfBaseColorUvChannel: 'int',
  uGltfBaseColorUvTransform: 'mat3',
  uGltfAlphaCutoff: 'float',
} as const satisfies Readonly<Record<GltfSurfaceContractIdentifier, string>>

const surfaceDeclarations = Object.freeze(GLTF_SURFACE_CONTRACT_IDENTIFIERS.map(
  (identifier) => `uniform ${GLTF_SURFACE_UNIFORM_TYPES[identifier]} ${identifier};`,
))

const GLTF_PBR_ONLY_UNIFORM_TYPES = {
  uGltfMetallicFactor: 'float',
  uGltfRoughnessFactor: 'float',
  uGltfMetallicMap: 'sampler2D',
  uGltfRoughnessMap: 'sampler2D',
  uGltfHasMetallicMap: 'bool',
  uGltfHasRoughnessMap: 'bool',
  uGltfMetallicUvChannel: 'int',
  uGltfRoughnessUvChannel: 'int',
  uGltfMetallicUvTransform: 'mat3',
  uGltfRoughnessUvTransform: 'mat3',
  uGltfNormalMap: 'sampler2D',
  uGltfHasNormalMap: 'bool',
  uGltfNormalUvChannel: 'int',
  uGltfNormalUvTransform: 'mat3',
  uGltfNormalScale: 'vec2',
  uEnvironmentMap: 'sampler2D',
  uEnvironmentRotation: 'mat3',
  uEnvironmentIntensity: 'float',
} as const satisfies Readonly<Record<GltfPbrOnlyContractIdentifier, string>>

const pbrOnlyIdentifiers = GLTF_PBR_CONTRACT_IDENTIFIERS.slice(
  GLTF_SURFACE_CONTRACT_IDENTIFIERS.length,
) as readonly GltfPbrOnlyContractIdentifier[]
const pbrDeclarations = Object.freeze(pbrOnlyIdentifiers.map(
  (identifier) => `uniform ${GLTF_PBR_ONLY_UNIFORM_TYPES[identifier]} ${identifier};`,
))

const SURFACE_HELPERS = /* glsl */ `vec4 sampleGltfBaseColor() {
  vec2 sourceUv = uGltfBaseColorUvChannel == 1 ? vGltfUv1 : vUv;
  vec2 transformedUv = (uGltfBaseColorUvTransform * vec3(sourceUv, 1.0)).xy;
  vec4 texel = uGltfHasBaseColorMap
    ? texture(uGltfBaseColorMap, transformedUv)
    : vec4(1.0);
  return vec4(uGltfBaseColorFactor * texel.rgb, uGltfBaseColorOpacity * texel.a);
}`

export const surfaceProfileContract: Readonly<{
  identifiers: typeof GLTF_SURFACE_CONTRACT_IDENTIFIERS
  declarations: readonly string[]
  source: string
}> = Object.freeze({
  identifiers: GLTF_SURFACE_CONTRACT_IDENTIFIERS,
  declarations: surfaceDeclarations,
  source: [
    'in vec2 vGltfUv1;',
    '',
    ...surfaceDeclarations,
    '',
    SURFACE_HELPERS,
  ].join('\n'),
})

export const pbrProfileContract: Readonly<{
  identifiers: typeof GLTF_PBR_CONTRACT_IDENTIFIERS
  declarations: readonly string[]
  source: string
}> = Object.freeze({
  identifiers: GLTF_PBR_CONTRACT_IDENTIFIERS,
  declarations: pbrDeclarations,
  source: [
    surfaceProfileContract.source,
    '',
    ...pbrDeclarations,
    '',
    '#ifndef ENVMAP_TYPE_CUBE_UV',
    '#define ENVMAP_TYPE_CUBE_UV',
    '#endif',
    '#ifndef CUBEUV_TEXEL_WIDTH',
    '#define CUBEUV_TEXEL_WIDTH 0.0208333333333',
    '#define CUBEUV_TEXEL_HEIGHT 0.015625',
    '#define CUBEUV_MAX_MIP 4.0',
    '#endif',
    '#include <cube_uv_reflection_fragment>',
  ].join('\n'),
})

/** Returns only the application-owned declarations required by the selected profile. */
export function profileContractSource(profile: MaterialInputProfile): string {
  if (profile === 'none') return ''
  return profile === 'gltf-pbr' ? pbrProfileContract.source : surfaceProfileContract.source
}
