import {
  GLTF_SURFACE_CONTRACT_IDENTIFIERS,
  type MaterialInputProfile,
} from '../../domain/materialInput'

type GltfSurfaceContractIdentifier = (typeof GLTF_SURFACE_CONTRACT_IDENTIFIERS)[number]

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

const SURFACE_HELPERS = /* glsl */ `vec3 gltfSrgbToLinear(vec3 value) {
  bvec3 cutoff = lessThanEqual(value, vec3(0.04045));
  vec3 lower = value / 12.92;
  vec3 higher = pow((value + 0.055) / 1.055, vec3(2.4));
  return mix(higher, lower, cutoff);
}

vec4 sampleGltfBaseColor() {
  vec2 sourceUv = uGltfBaseColorUvChannel == 1 ? vGltfUv1 : vUv;
  vec2 transformedUv = (uGltfBaseColorUvTransform * vec3(sourceUv, 1.0)).xy;
  vec4 texel = uGltfHasBaseColorMap
    ? texture(uGltfBaseColorMap, transformedUv)
    : vec4(1.0);
  if (uGltfHasBaseColorMap) texel.rgb = gltfSrgbToLinear(texel.rgb);
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

/** Returns only the application-owned declarations required by the selected profile. */
export function profileContractSource(profile: MaterialInputProfile): string {
  return profile === 'none' ? '' : surfaceProfileContract.source
}
