import { Color, DataTexture, Matrix3, Texture, Vector2 } from 'three'

export interface TextureInput {
  readonly texture: Texture | null
  readonly uvChannel: 0 | 1
  readonly uvTransform: Matrix3
}

export interface GltfSurfaceInputs extends TextureInput {
  readonly baseColorFactor: Color
  readonly opacity: number
  readonly alphaCutoff: number
}

export interface GltfPbrInputs {
  readonly metallicFactor: number
  readonly roughnessFactor: number
  readonly metallic: TextureInput
  readonly roughness: TextureInput
  readonly normal: TextureInput
  readonly normalScale: Vector2
  readonly occlusion: TextureInput
  readonly occlusionStrength: number
  readonly emissive: TextureInput
  readonly emissiveFactor: Color
  readonly emissiveIntensity: number
}

interface SurfaceMaterialCapabilities {
  color?: unknown
  map?: unknown
}

interface PrimitiveMaterialCapabilities {
  isLineBasicMaterial?: unknown
  isLineDashedMaterial?: unknown
  isPointsMaterial?: unknown
}

interface PbrMaterialCapabilities {
  metalness?: unknown
  roughness?: unknown
  metalnessMap?: unknown
  roughnessMap?: unknown
  normalMap?: unknown
  normalScale?: unknown
  aoMap?: unknown
  aoMapIntensity?: unknown
  emissiveMap?: unknown
  emissive?: unknown
  emissiveIntensity?: unknown
}

/** Creates the binding owner's neutral texture resource. */
export function createWhiteFallbackTexture(): DataTexture {
  const texture = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  texture.name = 'GLTF surface white fallback'
  texture.needsUpdate = true
  return texture
}

/** Creates a tangent-space +Z normal for missing or incompatible normal inputs. */
export function createNeutralNormalFallbackTexture(): DataTexture {
  const texture = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)
  texture.name = 'GLTF PBR neutral normal fallback'
  texture.needsUpdate = true
  return texture
}

/** Reads a borrowed texture plus the GLTF UV selection and transform metadata. */
export function extractTextureInput(value: unknown): TextureInput {
  const texture = isTexture(value) ? value : null
  if (texture === null) {
    return {
      texture: null,
      uvChannel: 0,
      uvTransform: new Matrix3(),
    }
  }

  if (texture.matrixAutoUpdate) texture.updateMatrix()
  return {
    texture,
    uvChannel: texture.channel === 1 ? 1 : 0,
    uvTransform: texture.matrix.clone(),
  }
}

/** Extracts mesh-like GLTF surface fields without taking ownership of source resources. */
export function extractGltfSurfaceInputs(material: object): GltfSurfaceInputs {
  const capabilities = material as SurfaceMaterialCapabilities
  const hasSurfaceInputs = !isLineOrPointMaterial(material)
  const textureInput = extractTextureInput(hasSurfaceInputs ? capabilities.map : null)

  return {
    ...textureInput,
    baseColorFactor: hasSurfaceInputs && isColor(capabilities.color)
      ? capabilities.color.clone()
      : new Color(0xffffff),
    opacity: finiteNumber(readProperty(material, 'opacity'), 1),
    alphaCutoff: finiteNumber(readProperty(material, 'alphaTest'), 0),
  }
}

/** Extracts metallic/roughness capabilities while preserving borrowed texture metadata. */
export function extractGltfPbrInputs(material: object): GltfPbrInputs {
  const capabilities = material as PbrMaterialCapabilities
  const hasPbrInputs = !isLineOrPointMaterial(material) && hasAnyPbrCapability(material)

  return {
    metallicFactor: hasPbrInputs ? finiteNumber(capabilities.metalness, 0) : 0,
    roughnessFactor: hasPbrInputs ? finiteNumber(capabilities.roughness, 1) : 1,
    metallic: extractTextureInput(hasPbrInputs ? capabilities.metalnessMap : null),
    roughness: extractTextureInput(hasPbrInputs ? capabilities.roughnessMap : null),
    normal: extractTextureInput(hasPbrInputs ? capabilities.normalMap : null),
    normalScale: hasPbrInputs ? finiteVector2(capabilities.normalScale) : new Vector2(1, 1),
    occlusion: extractTextureInput(hasPbrInputs ? capabilities.aoMap : null),
    occlusionStrength: hasPbrInputs ? finiteNumber(capabilities.aoMapIntensity, 1) : 1,
    emissive: extractTextureInput(hasPbrInputs ? capabilities.emissiveMap : null),
    emissiveFactor: hasPbrInputs && isColor(capabilities.emissive)
      ? capabilities.emissive.clone()
      : new Color(0x000000),
    emissiveIntensity: hasPbrInputs ? finiteNumber(capabilities.emissiveIntensity, 1) : 1,
  }
}

function isColor(value: unknown): value is Color {
  return typeof value === 'object'
    && value !== null
    && (value as { isColor?: unknown }).isColor === true
}

function isTexture(value: unknown): value is Texture {
  return typeof value === 'object'
    && value !== null
    && (value as { isTexture?: unknown }).isTexture === true
}

function isVector2(value: unknown): value is Vector2 {
  return typeof value === 'object'
    && value !== null
    && (value as { isVector2?: unknown }).isVector2 === true
}

function finiteVector2(value: unknown): Vector2 {
  return isVector2(value) && Number.isFinite(value.x) && Number.isFinite(value.y)
    ? value.clone()
    : new Vector2(1, 1)
}

function hasAnyPbrCapability(material: object): boolean {
  return [
    'metalness',
    'roughness',
    'metalnessMap',
    'roughnessMap',
    'normalMap',
    'normalScale',
    'aoMap',
    'aoMapIntensity',
    'emissiveMap',
    'emissive',
    'emissiveIntensity',
  ].some((property) => property in material)
}

function isLineOrPointMaterial(material: object): boolean {
  const capabilities = material as PrimitiveMaterialCapabilities
  return capabilities.isLineBasicMaterial === true
    || capabilities.isLineDashedMaterial === true
    || capabilities.isPointsMaterial === true
}

function readProperty(value: object, property: string): unknown {
  return (value as Record<string, unknown>)[property]
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
