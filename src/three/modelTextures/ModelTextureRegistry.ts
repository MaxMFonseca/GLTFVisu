import {
  Material,
  NoColorSpace,
  Object3D,
  SRGBColorSpace,
  Texture,
  type ColorSpace,
} from 'three'

export type ModelTextureChannel =
  | 'base-color'
  | 'normal'
  | 'metallic-roughness'
  | 'occlusion'
  | 'emissive'

export interface ModelTextureSlotInfo {
  id: string
  materialLabel: string
  channel: ModelTextureChannel
  label: string
  previewUrl: string
  replaced: boolean
}

export interface ModelTextureMutation {
  apply(): void
  commit(): void
  rollback(): void
}

export interface ModelTextureRegistryDependencies {
  decode(file: File): Promise<Texture>
  createPreview(texture: Texture): Promise<string>
  revokePreview(url: string): void
}

interface SlotDefinition {
  channel: ModelTextureChannel
  label: string
  properties: readonly string[]
  colorSpace: ColorSpace
}

interface SlotRecord {
  info: ModelTextureSlotInfo
  material: Material & Record<string, unknown>
  properties: readonly string[]
  originals: readonly (Texture | null)[]
  originalPreviewUrl: string
  activeReplacement: Texture | null
  replacementPreviewUrl: string | null
  colorSpace: ColorSpace
}

const SLOT_DEFINITIONS: readonly SlotDefinition[] = [
  { channel: 'base-color', label: 'Base color', properties: ['map'], colorSpace: SRGBColorSpace },
  { channel: 'normal', label: 'Normal', properties: ['normalMap'], colorSpace: NoColorSpace },
  { channel: 'metallic-roughness', label: 'Metallic / roughness', properties: ['metalnessMap', 'roughnessMap'], colorSpace: NoColorSpace },
  { channel: 'occlusion', label: 'Occlusion', properties: ['aoMap'], colorSpace: NoColorSpace },
  { channel: 'emissive', label: 'Emissive', properties: ['emissiveMap'], colorSpace: SRGBColorSpace },
]

/** Owns session replacements and previews while borrowing all GLTF-provided textures. */
export class ModelTextureRegistry {
  private disposed = false
  private readonly ownedTextures = new Set<Texture>()
  private readonly ownedPreviewUrls: Set<string>

  private constructor(
    private readonly slots: SlotRecord[],
    private readonly dependencies: ModelTextureRegistryDependencies,
  ) {
    this.ownedPreviewUrls = new Set(slots.map(({ originalPreviewUrl }) => originalPreviewUrl))
  }

  static async create(
    root: Object3D,
    dependencies: ModelTextureRegistryDependencies = defaultDependencies(),
  ): Promise<ModelTextureRegistry> {
    const uniqueMaterials = collectMaterials(root)
    const slots: SlotRecord[] = []
    try {
      for (let materialIndex = 0; materialIndex < uniqueMaterials.length; materialIndex += 1) {
        const material = uniqueMaterials[materialIndex] as Material & Record<string, unknown>
        const materialLabel = material.name.trim() || `Material ${materialIndex + 1}`
        for (const definition of SLOT_DEFINITIONS) {
          const originals = definition.properties.map((property) => textureOrNull(material[property]))
          const previewTexture = originals.find((texture) => texture !== null)
          if (previewTexture === undefined) continue
          const originalPreviewUrl = await dependencies.createPreview(previewTexture)
          slots.push({
            info: {
              id: `material-${materialIndex}:${definition.channel}`,
              materialLabel,
              channel: definition.channel,
              label: definition.label,
              previewUrl: originalPreviewUrl,
              replaced: false,
            },
            material,
            properties: definition.properties,
            originals,
            originalPreviewUrl,
            activeReplacement: null,
            replacementPreviewUrl: null,
            colorSpace: definition.colorSpace,
          })
        }
      }
      return new ModelTextureRegistry(slots, dependencies)
    } catch (error) {
      for (const slot of slots) {
        bestEffort(() => dependencies.revokePreview(slot.originalPreviewUrl))
      }
      throw error
    }
  }

  list(): readonly ModelTextureSlotInfo[] {
    this.assertActive()
    return this.slots.map(({ info }) => ({ ...info }))
  }

  async prepareReplace(slotId: string, file: File): Promise<ModelTextureMutation> {
    this.assertActive()
    const slot = this.slot(slotId)
    const candidate = await this.dependencies.decode(file)
    this.ownedTextures.add(candidate)
    let candidatePreviewUrl: string | null = null
    try {
      this.assertActive()
      configureReplacement(candidate, currentTexture(slot), slot.colorSpace)
      candidatePreviewUrl = await this.dependencies.createPreview(candidate)
      this.ownedPreviewUrls.add(candidatePreviewUrl)
      this.assertActive()
    } catch (error) {
      if (candidatePreviewUrl !== null) this.releasePreview(candidatePreviewUrl)
      this.releaseTexture(candidate)
      throw error
    }
    return this.mutation(slot, candidate, candidatePreviewUrl)
  }

  prepareRestore(slotId: string): ModelTextureMutation {
    this.assertActive()
    return this.mutation(this.slot(slotId), null, null)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const slot of this.slots) {
      assignSlotTextures(slot, slot.originals)
      slot.activeReplacement = null
      slot.replacementPreviewUrl = null
    }
    for (const texture of [...this.ownedTextures]) this.releaseTexture(texture)
    for (const url of [...this.ownedPreviewUrls]) this.releasePreview(url)
  }

  private mutation(
    slot: SlotRecord,
    candidate: Texture | null,
    candidatePreviewUrl: string | null,
  ): ModelTextureMutation {
    const predecessor = slot.activeReplacement
    const predecessorPreviewUrl = slot.replacementPreviewUrl
    let state: 'prepared' | 'applied' | 'complete' = 'prepared'
    const apply = () => {
      if (state !== 'prepared') throw new Error('Texture mutation is not prepared')
      this.assertActive()
      assignSlotTextures(slot, candidate === null ? slot.originals : slot.properties.map(() => candidate))
      slot.activeReplacement = candidate
      slot.replacementPreviewUrl = candidatePreviewUrl
      slot.info = {
        ...slot.info,
        previewUrl: candidatePreviewUrl ?? slot.originalPreviewUrl,
        replaced: candidate !== null,
      }
      state = 'applied'
    }
    return {
      apply,
      commit: () => {
        if (state === 'prepared') apply()
        if (state !== 'applied') return
        state = 'complete'
        if (predecessor !== null && predecessor !== candidate) this.releaseTexture(predecessor)
        if (predecessorPreviewUrl !== null && predecessorPreviewUrl !== candidatePreviewUrl) {
          this.releasePreview(predecessorPreviewUrl)
        }
      },
      rollback: () => {
        if (state === 'complete') return
        if (state === 'applied' && !this.disposed) {
          assignSlotTextures(slot, predecessor === null ? slot.originals : slot.properties.map(() => predecessor))
          slot.activeReplacement = predecessor
          slot.replacementPreviewUrl = predecessorPreviewUrl
          slot.info = {
            ...slot.info,
            previewUrl: predecessorPreviewUrl ?? slot.originalPreviewUrl,
            replaced: predecessor !== null,
          }
        }
        state = 'complete'
        if (candidate !== null && candidate !== predecessor) this.releaseTexture(candidate)
        if (candidatePreviewUrl !== null && candidatePreviewUrl !== predecessorPreviewUrl) {
          this.releasePreview(candidatePreviewUrl)
        }
      },
    }
  }

  private slot(id: string): SlotRecord {
    const slot = this.slots.find(({ info }) => info.id === id)
    if (slot === undefined) throw new Error('Unknown model texture slot')
    return slot
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Model texture registry is disposed')
  }

  private releaseTexture(texture: Texture): void {
    if (!this.ownedTextures.delete(texture)) return
    disposeOwnedTexture(texture)
  }

  private releasePreview(url: string): void {
    if (!this.ownedPreviewUrls.delete(url)) return
    bestEffort(() => this.dependencies.revokePreview(url))
  }
}

function collectMaterials(root: Object3D): Material[] {
  const materials: Material[] = []
  const seen = new Set<Material>()
  root.traverse((object) => {
    const assignment = (object as Object3D & { material?: Material | Material[] }).material
    const assignedMaterials = Array.isArray(assignment) ? assignment : [assignment]
    for (const material of assignedMaterials) {
      if (!(material instanceof Material) || seen.has(material)) continue
      seen.add(material)
      materials.push(material)
    }
  })
  return materials
}

function textureOrNull(value: unknown): Texture | null {
  return value instanceof Texture ? value : null
}

function currentTexture(slot: SlotRecord): Texture {
  return slot.activeReplacement ?? slot.originals.find((texture) => texture !== null)!
}

function assignSlotTextures(slot: SlotRecord, textures: readonly (Texture | null)[]): void {
  slot.properties.forEach((property, index) => {
    slot.material[property] = textures[index] ?? null
  })
  slot.material.needsUpdate = true
}

function configureReplacement(texture: Texture, predecessor: Texture, colorSpace: ColorSpace): void {
  texture.colorSpace = colorSpace
  texture.flipY = false
  texture.channel = predecessor.channel
  texture.wrapS = predecessor.wrapS
  texture.wrapT = predecessor.wrapT
  texture.magFilter = predecessor.magFilter
  texture.minFilter = predecessor.minFilter
  texture.anisotropy = predecessor.anisotropy
  texture.generateMipmaps = predecessor.generateMipmaps
  texture.offset.copy(predecessor.offset)
  texture.repeat.copy(predecessor.repeat)
  texture.center.copy(predecessor.center)
  texture.rotation = predecessor.rotation
  texture.matrixAutoUpdate = predecessor.matrixAutoUpdate
  texture.matrix.copy(predecessor.matrix)
  texture.needsUpdate = true
}

function disposeOwnedTexture(texture: Texture): void {
  bestEffort(() => texture.dispose())
  const image = texture.image as { close?: () => void } | undefined
  if (image?.close !== undefined) bestEffort(() => image.close?.())
}

function bestEffort(cleanup: () => void): void {
  try {
    cleanup()
  } catch {
    // Cleanup is terminal and ownership is already detached; continue releasing later resources.
  }
}

function defaultDependencies(): ModelTextureRegistryDependencies {
  return {
    decode: async (file) => {
      const image = await createImageBitmap(file, { colorSpaceConversion: 'none' })
      return new Texture(image)
    },
    createPreview: async (texture) => {
      const image = texture.image as CanvasImageSource & { width?: number; height?: number }
      const sourceWidth = Math.max(1, image.width ?? 1)
      const sourceHeight = Math.max(1, image.height ?? 1)
      const scale = Math.min(1, 192 / Math.max(sourceWidth, sourceHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(sourceWidth * scale))
      canvas.height = Math.max(1, Math.round(sourceHeight * scale))
      const context = canvas.getContext('2d')
      if (context === null) throw new Error('Unable to create texture preview')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (value) => value === null ? reject(new Error('Unable to encode texture preview')) : resolve(value),
        'image/png',
      ))
      return URL.createObjectURL(blob)
    },
    revokePreview: (url) => URL.revokeObjectURL(url),
  }
}
