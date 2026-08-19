import {
  Group,
  MirroredRepeatWrapping,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  ModelTextureRegistry,
  type ModelTextureMutation,
  type ModelTextureRegistryDependencies,
} from './ModelTextureRegistry'

function dependencies(): ModelTextureRegistryDependencies {
  return {
    decode: vi.fn(),
    createPreview: vi.fn(async (texture: Texture) => `preview:${texture.uuid}`),
    revokePreview: vi.fn(),
  }
}

describe('ModelTextureRegistry', () => {
  it('discovers populated slots in stable unique-material order', async () => {
    const packedMap = new Texture()
    const armor = new MeshStandardMaterial({
      name: 'Armor',
      map: new Texture(),
      normalMap: new Texture(),
      metalnessMap: packedMap,
      roughnessMap: packedMap,
      aoMap: new Texture(),
      emissiveMap: new Texture(),
    })
    const unnamed = new MeshStandardMaterial({ map: new Texture() })
    const empty = new MeshStandardMaterial()
    const root = new Group()
    root.add(
      new Mesh(undefined, armor),
      new Mesh(undefined, [armor, unnamed]),
      new Mesh(undefined, empty),
    )

    const registry = await ModelTextureRegistry.create(root, dependencies())

    expect(registry.list().map(({ materialLabel, channel }) => [materialLabel, channel])).toEqual([
      ['Armor', 'base-color'],
      ['Armor', 'normal'],
      ['Armor', 'metallic-roughness'],
      ['Armor', 'occlusion'],
      ['Armor', 'emissive'],
      ['Material 2', 'base-color'],
    ])
    expect(registry.list().map(({ id }) => id)).toEqual([
      'material-0:base-color',
      'material-0:normal',
      'material-0:metallic-roughness',
      'material-0:occlusion',
      'material-0:emissive',
      'material-1:base-color',
    ])
  })

  it('assigns stable identities and disambiguates duplicate non-empty material names', async () => {
    const first = new MeshStandardMaterial({ name: 'Shared', map: new Texture() })
    const second = new MeshStandardMaterial({ name: 'Shared', normalMap: new Texture() })
    const registry = await ModelTextureRegistry.create(
      new Group().add(new Mesh(undefined, first), new Mesh(undefined, second)),
      dependencies(),
    )

    expect(registry.list().map(({ materialId, materialLabel, channel }) => ({
      materialId,
      materialLabel,
      channel,
    }))).toEqual([
      { materialId: 'material-0', materialLabel: 'Shared (1)', channel: 'base-color' },
      { materialId: 'material-1', materialLabel: 'Shared (2)', channel: 'normal' },
    ])
  })

  it('prepares a base-color replacement before applying it transactionally', async () => {
    const original = new Texture()
    original.channel = 2
    original.wrapS = RepeatWrapping
    original.wrapT = MirroredRepeatWrapping
    original.magFilter = NearestFilter
    original.minFilter = NearestFilter
    original.anisotropy = 4
    original.generateMipmaps = false
    original.offset.set(0.1, 0.2)
    original.repeat.set(0.3, 0.4)
    original.center.set(0.5, 0.6)
    original.rotation = 0.7
    original.matrixAutoUpdate = false
    original.updateMatrix()
    const candidate = new Texture()
    const material = new MeshStandardMaterial({ map: original })
    const root = new Group().add(new Mesh(undefined, material))
    const deps: ModelTextureRegistryDependencies = {
      decode: vi.fn(async () => candidate),
      createPreview: vi.fn(async (texture) => texture === candidate ? 'candidate-preview' : 'original-preview'),
      revokePreview: vi.fn(),
    }
    const registry = await ModelTextureRegistry.create(root, deps)
    const initialMaterialVersion = material.version

    const mutation = await registry.prepareReplace('material-0:base-color', {} as File)

    expect(material.map).toBe(original)
    expect(material.version).toBe(initialMaterialVersion)
    expect(registry.list()[0]).toMatchObject({ previewUrl: 'original-preview', replaced: false })
    expect(candidate).toMatchObject({
      colorSpace: SRGBColorSpace,
      flipY: false,
      channel: 2,
      wrapS: RepeatWrapping,
      wrapT: MirroredRepeatWrapping,
      magFilter: NearestFilter,
      minFilter: NearestFilter,
      anisotropy: 4,
      generateMipmaps: false,
      rotation: 0.7,
      matrixAutoUpdate: false,
    })
    expect(candidate.offset.equals(original.offset)).toBe(true)
    expect(candidate.repeat.equals(original.repeat)).toBe(true)
    expect(candidate.center.equals(original.center)).toBe(true)
    expect(candidate.matrix.equals(original.matrix)).toBe(true)

    mutation.apply()

    expect(material.map).toBe(candidate)
    expect(material.version).toBe(initialMaterialVersion + 1)
    expect(registry.list()[0]).toMatchObject({ previewUrl: 'candidate-preview', replaced: true })
    mutation.commit()
  })

  it('uses the required color space for every non-base-color channel', async () => {
    const material = new MeshStandardMaterial({
      normalMap: new Texture(),
      metalnessMap: new Texture(),
      roughnessMap: new Texture(),
      aoMap: new Texture(),
      emissiveMap: new Texture(),
    })
    const candidates = [new Texture(), new Texture(), new Texture(), new Texture()]
    let candidateIndex = 0
    const deps: ModelTextureRegistryDependencies = {
      decode: vi.fn(async () => candidates[candidateIndex++]),
      createPreview: vi.fn(async (texture) => `preview:${texture.uuid}`),
      revokePreview: vi.fn(),
    }
    const registry = await ModelTextureRegistry.create(
      new Group().add(new Mesh(undefined, material)),
      deps,
    )
    const expectations = [
      ['normal', NoColorSpace],
      ['metallic-roughness', NoColorSpace],
      ['occlusion', NoColorSpace],
      ['emissive', SRGBColorSpace],
    ] as const

    for (const [index, [channel, colorSpace]] of expectations.entries()) {
      const slot = registry.list().find((entry) => entry.channel === channel)!
      const mutation = await registry.prepareReplace(slot.id, {} as File)
      expect(candidates[index].colorSpace).toBe(colorSpace)
      mutation.rollback()
    }
  })

  it('updates both packed properties and restores their distinct original references', async () => {
    const originalMetalness = new Texture()
    const originalRoughness = new Texture()
    const candidate = new Texture()
    const closeCandidate = vi.fn()
    candidate.image = { close: closeCandidate }
    const disposeCandidate = vi.spyOn(candidate, 'dispose')
    const disposeMetalness = vi.spyOn(originalMetalness, 'dispose')
    const disposeRoughness = vi.spyOn(originalRoughness, 'dispose')
    const material = new MeshStandardMaterial({
      metalnessMap: originalMetalness,
      roughnessMap: originalRoughness,
    })
    const revokePreview = vi.fn()
    const registry = await ModelTextureRegistry.create(
      new Group().add(new Mesh(undefined, material)),
      {
        decode: vi.fn(async () => candidate),
        createPreview: vi.fn(async (texture) => texture === candidate ? 'candidate-preview' : `original:${texture.uuid}`),
        revokePreview,
      },
    )

    const replacement = await registry.prepareReplace('material-0:metallic-roughness', {} as File)
    replacement.apply()
    expect(material.metalnessMap).toBe(candidate)
    expect(material.roughnessMap).toBe(candidate)
    replacement.commit()

    const restore = registry.prepareRestore('material-0:metallic-roughness')
    restore.apply()
    expect(material.metalnessMap).toBe(originalMetalness)
    expect(material.roughnessMap).toBe(originalRoughness)
    expect(registry.list()[0].replaced).toBe(false)
    restore.commit()

    expect(disposeCandidate).toHaveBeenCalledTimes(1)
    expect(closeCandidate).toHaveBeenCalledTimes(1)
    expect(revokePreview).toHaveBeenCalledWith('candidate-preview')
    expect(disposeMetalness).not.toHaveBeenCalled()
    expect(disposeRoughness).not.toHaveBeenCalled()
  })

  it('keeps the predecessor active when replacement preview preparation fails', async () => {
    const original = new Texture()
    const predecessor = new Texture()
    const failedCandidate = new Texture()
    const closeFailedCandidate = vi.fn()
    failedCandidate.image = { close: closeFailedCandidate }
    const disposePredecessor = vi.spyOn(predecessor, 'dispose')
    const disposeFailedCandidate = vi.spyOn(failedCandidate, 'dispose')
    const material = new MeshStandardMaterial({ map: original })
    const decode = vi.fn()
      .mockResolvedValueOnce(predecessor)
      .mockResolvedValueOnce(failedCandidate)
    const registry = await ModelTextureRegistry.create(
      new Group().add(new Mesh(undefined, material)),
      {
        decode,
        createPreview: vi.fn(async (texture) => {
          if (texture === failedCandidate) throw new Error('preview failed')
          return texture === predecessor ? 'predecessor-preview' : 'original-preview'
        }),
        revokePreview: vi.fn(),
      },
    )
    const firstMutation = await registry.prepareReplace('material-0:base-color', {} as File)
    firstMutation.apply()
    firstMutation.commit()

    await expect(registry.prepareReplace('material-0:base-color', {} as File)).rejects.toThrow('preview failed')

    expect(material.map).toBe(predecessor)
    expect(registry.list()[0]).toMatchObject({ previewUrl: 'predecessor-preview', replaced: true })
    expect(disposePredecessor).not.toHaveBeenCalled()
    expect(disposeFailedCandidate).toHaveBeenCalledTimes(1)
    expect(closeFailedCandidate).toHaveBeenCalledTimes(1)
  })

  it('rolls an applied replacement back to its predecessor', async () => {
    const original = new Texture()
    const predecessor = new Texture()
    const candidate = new Texture()
    const disposeCandidate = vi.spyOn(candidate, 'dispose')
    const material = new MeshStandardMaterial({ map: original })
    const decode = vi.fn()
      .mockResolvedValueOnce(predecessor)
      .mockResolvedValueOnce(candidate)
    const revokePreview = vi.fn()
    const registry = await ModelTextureRegistry.create(
      new Group().add(new Mesh(undefined, material)),
      {
        decode,
        createPreview: vi.fn(async (texture) => texture === original
          ? 'original-preview'
          : texture === predecessor ? 'predecessor-preview' : 'candidate-preview'),
        revokePreview,
      },
    )
    const predecessorMutation = await registry.prepareReplace('material-0:base-color', {} as File)
    predecessorMutation.apply()
    predecessorMutation.commit()
    const candidateMutation = await registry.prepareReplace('material-0:base-color', {} as File)
    candidateMutation.apply()

    candidateMutation.rollback()
    candidateMutation.rollback()

    expect(material.map).toBe(predecessor)
    expect(registry.list()[0]).toMatchObject({ previewUrl: 'predecessor-preview', replaced: true })
    expect(disposeCandidate).toHaveBeenCalledTimes(1)
    expect(revokePreview).toHaveBeenCalledWith('candidate-preview')
  })

  it('releases superseded owned resources once and disposes idempotently', async () => {
    const original = new Texture()
    const first = new Texture()
    const second = new Texture()
    const closeFirst = vi.fn()
    const closeSecond = vi.fn()
    first.image = { close: closeFirst }
    second.image = { close: closeSecond }
    const disposeOriginal = vi.spyOn(original, 'dispose')
    const disposeFirst = vi.spyOn(first, 'dispose')
    const disposeSecond = vi.spyOn(second, 'dispose')
    const material = new MeshStandardMaterial({ map: original })
    const decode = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
    const revokePreview = vi.fn()
    const registry = await ModelTextureRegistry.create(
      new Group().add(new Mesh(undefined, material)),
      {
        decode,
        createPreview: vi.fn(async (texture) => texture === original
          ? 'original-preview'
          : texture === first ? 'first-preview' : 'second-preview'),
        revokePreview,
      },
    )
    const firstMutation = await registry.prepareReplace('material-0:base-color', {} as File)
    firstMutation.apply()
    firstMutation.commit()
    const secondMutation = await registry.prepareReplace('material-0:base-color', {} as File)
    secondMutation.apply()
    secondMutation.commit()

    expect(disposeFirst).toHaveBeenCalledTimes(1)
    expect(closeFirst).toHaveBeenCalledTimes(1)
    expect(revokePreview).toHaveBeenCalledWith('first-preview')

    registry.dispose()
    registry.dispose()

    expect(material.map).toBe(original)
    expect(disposeOriginal).not.toHaveBeenCalled()
    expect(disposeFirst).toHaveBeenCalledTimes(1)
    expect(disposeSecond).toHaveBeenCalledTimes(1)
    expect(closeFirst).toHaveBeenCalledTimes(1)
    expect(closeSecond).toHaveBeenCalledTimes(1)
    expect(revokePreview).toHaveBeenCalledTimes(3)
    expect(revokePreview.mock.calls).toEqual(expect.arrayContaining([
      ['first-preview'],
      ['second-preview'],
      ['original-preview'],
    ]))
  })

  it('releases a prepared replacement if the registry is disposed before apply', async () => {
    const original = new Texture()
    const candidate = new Texture()
    const closeCandidate = vi.fn()
    candidate.image = { close: closeCandidate }
    const disposeCandidate = vi.spyOn(candidate, 'dispose')
    const material = new MeshStandardMaterial({ map: original })
    const revokePreview = vi.fn()
    const registry = await ModelTextureRegistry.create(
      new Group().add(new Mesh(undefined, material)),
      {
        decode: vi.fn(async () => candidate),
        createPreview: vi.fn(async (texture) => texture === original ? 'original-preview' : 'candidate-preview'),
        revokePreview,
      },
    )
    const mutation = await registry.prepareReplace('material-0:base-color', {} as File)

    registry.dispose()
    expect(material.map).toBe(original)
    expect(disposeCandidate).toHaveBeenCalledTimes(1)
    expect(closeCandidate).toHaveBeenCalledTimes(1)
    expect(revokePreview.mock.calls).toEqual([
      ['original-preview'],
      ['candidate-preview'],
    ])

    mutation.rollback()

    expect(material.map).toBe(original)
    expect(disposeCandidate).toHaveBeenCalledTimes(1)
    expect(closeCandidate).toHaveBeenCalledTimes(1)
  })

  it('keeps a committed replacement active when every predecessor cleanup callback throws', async () => {
    const original = new Texture()
    const predecessor = new Texture()
    const candidate = new Texture()
    const candidateMutationRef: { current?: ModelTextureMutation } = {}
    const disposePredecessor = vi.spyOn(predecessor, 'dispose').mockImplementation(() => {
      candidateMutationRef.current?.commit()
      throw new Error('texture dispose failed')
    })
    const closePredecessor = vi.fn(() => {
      candidateMutationRef.current?.rollback()
      throw new Error('image close failed')
    })
    predecessor.image = { close: closePredecessor }
    const material = new MeshStandardMaterial({ map: original })
    const decode = vi.fn()
      .mockResolvedValueOnce(predecessor)
      .mockResolvedValueOnce(candidate)
    const revokePreview = vi.fn((url: string) => {
      if (url === 'predecessor-preview') {
        candidateMutationRef.current?.commit()
        throw new Error('preview revocation failed')
      }
    })
    const registry = await ModelTextureRegistry.create(
      new Group().add(new Mesh(undefined, material)),
      {
        decode,
        createPreview: vi.fn(async (texture) => texture === original
          ? 'original-preview'
          : texture === predecessor ? 'predecessor-preview' : 'candidate-preview'),
        revokePreview,
      },
    )
    const predecessorMutation = await registry.prepareReplace('material-0:base-color', {} as File)
    predecessorMutation.apply()
    predecessorMutation.commit()
    const candidateMutation = await registry.prepareReplace('material-0:base-color', {} as File)
    candidateMutationRef.current = candidateMutation
    candidateMutation.apply()

    expect(() => candidateMutation.commit()).not.toThrow()

    expect(material.map).toBe(candidate)
    expect(registry.list()[0]).toMatchObject({ previewUrl: 'candidate-preview', replaced: true })
    expect(disposePredecessor).toHaveBeenCalledTimes(1)
    expect(closePredecessor).toHaveBeenCalledTimes(1)
    expect(revokePreview.mock.calls.filter(([url]) => url === 'predecessor-preview')).toHaveLength(1)

    candidateMutation.rollback()
    expect(material.map).toBe(candidate)
  })

  it('attempts every owned cleanup once when disposal callbacks throw', async () => {
    const originalBaseColor = new Texture()
    const originalNormal = new Texture()
    const candidateBaseColor = new Texture()
    const candidateNormal = new Texture()
    const disposeBaseColor = vi.spyOn(candidateBaseColor, 'dispose').mockImplementation(() => {
      throw new Error('base-color texture dispose failed')
    })
    const disposeNormal = vi.spyOn(candidateNormal, 'dispose').mockImplementation(() => {
      throw new Error('normal texture dispose failed')
    })
    const closeBaseColor = vi.fn(() => {
      throw new Error('base-color image close failed')
    })
    const closeNormal = vi.fn(() => {
      throw new Error('normal image close failed')
    })
    candidateBaseColor.image = { close: closeBaseColor }
    candidateNormal.image = { close: closeNormal }
    const material = new MeshStandardMaterial({
      map: originalBaseColor,
      normalMap: originalNormal,
    })
    const decode = vi.fn()
      .mockResolvedValueOnce(candidateBaseColor)
      .mockResolvedValueOnce(candidateNormal)
    const revokePreview = vi.fn((url: string) => {
      throw new Error(`preview revocation failed: ${url}`)
    })
    const registry = await ModelTextureRegistry.create(
      new Group().add(new Mesh(undefined, material)),
      {
        decode,
        createPreview: vi.fn(async (texture) => `preview:${texture.uuid}`),
        revokePreview,
      },
    )
    for (const channel of ['base-color', 'normal'] as const) {
      const slot = registry.list().find((entry) => entry.channel === channel)!
      const mutation = await registry.prepareReplace(slot.id, {} as File)
      mutation.apply()
      mutation.commit()
    }

    expect(() => registry.dispose()).not.toThrow()
    expect(() => registry.dispose()).not.toThrow()

    expect(material.map).toBe(originalBaseColor)
    expect(material.normalMap).toBe(originalNormal)
    expect(disposeBaseColor).toHaveBeenCalledTimes(1)
    expect(disposeNormal).toHaveBeenCalledTimes(1)
    expect(closeBaseColor).toHaveBeenCalledTimes(1)
    expect(closeNormal).toHaveBeenCalledTimes(1)
    expect(revokePreview).toHaveBeenCalledTimes(4)
    for (const texture of [originalBaseColor, originalNormal, candidateBaseColor, candidateNormal]) {
      expect(revokePreview.mock.calls.filter(([url]) => url === `preview:${texture.uuid}`)).toHaveLength(1)
    }
  })

  it('releases every completed preview after partial creation fails despite a throwing reentrant revoker', async () => {
    const nestedOriginal = new Texture()
    const nestedMaterial = new MeshStandardMaterial({ map: nestedOriginal })
    const nestedRegistryRef: { current?: ModelTextureRegistry } = {}
    const revokePreview = vi.fn((url: string) => {
      if (url === 'base-color-preview') {
        nestedRegistryRef.current?.dispose()
        throw new Error('base-color revocation failed')
      }
      if (url === 'nested-preview') throw new Error('nested revocation failed')
    })
    const nestedRegistry = await ModelTextureRegistry.create(
      new Group().add(new Mesh(undefined, nestedMaterial)),
      {
        decode: vi.fn(),
        createPreview: vi.fn(async () => 'nested-preview'),
        revokePreview,
      },
    )
    nestedRegistryRef.current = nestedRegistry

    const baseColor = new Texture()
    const normal = new Texture()
    const occlusion = new Texture()
    const material = new MeshStandardMaterial({
      map: baseColor,
      normalMap: normal,
      aoMap: occlusion,
    })
    const creationError = new Error('occlusion preview failed')
    const createPreview = vi.fn(async (texture: Texture) => {
      if (texture === baseColor) return 'base-color-preview'
      if (texture === normal) return 'normal-preview'
      throw creationError
    })
    let rejection: unknown

    try {
      await ModelTextureRegistry.create(
        new Group().add(new Mesh(undefined, material)),
        {
          decode: vi.fn(),
          createPreview,
          revokePreview,
        },
      )
    } catch (error) {
      rejection = error
    }

    expect(rejection).toBe(creationError)
    expect(revokePreview.mock.calls).toEqual([
      ['base-color-preview'],
      ['nested-preview'],
      ['normal-preview'],
    ])
  })
})
