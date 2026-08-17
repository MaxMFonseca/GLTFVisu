import { Color, DataTexture, Matrix3, Texture } from 'three'

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

interface SurfaceMaterialCapabilities {
  color?: unknown
  map?: unknown
}

interface PrimitiveMaterialCapabilities {
  isLineBasicMaterial?: unknown
  isLineDashedMaterial?: unknown
  isPointsMaterial?: unknown
}

/** Creates the binding owner's neutral texture resource. */
export function createWhiteFallbackTexture(): DataTexture {
  const texture = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  texture.name = 'GLTF surface white fallback'
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
